# backend/app/routes/invoices.py
from fastapi import APIRouter, HTTPException, Depends, Response
from pydantic import BaseModel
from typing import List, Optional, Dict
from datetime import datetime
import uuid
import re

from .auth import get_current_user
from .beneficiaries import fake_beneficiaries_db  # pour afficher le protégé

router = APIRouter(prefix="/invoices", tags=["invoices"])

# --------- Modèles ---------

class LineItem(BaseModel):
    amount: float = 0.0
    note: Optional[str] = None

class MissionSnapshot(BaseModel):
    id: str
    beneficiary_id: int
    categories: List[str] = []
    created_at: Optional[datetime] = None
    calendar_start: Optional[str] = None  # ISO
    calendar_end: Optional[str] = None    # ISO (end exclusif)
    delivered_at: Optional[datetime] = None

class InvoiceCreate(BaseModel):
    mission_id: str
    amount: float = 0.0
    status: str = "editing"  # editing | pending | paid
    note: Optional[str] = None
    lines_by_category: Optional[Dict[str, LineItem]] = None
    delivery_fee: Optional[float] = None
    mission: Optional[MissionSnapshot] = None  # snapshot optionnel

class InvoiceUpdate(BaseModel):
    amount: Optional[float] = None
    status: Optional[str] = None
    note: Optional[str] = None
    lines_by_category: Optional[Dict[str, LineItem]] = None
    delivery_fee: Optional[float] = None
    mission: Optional[MissionSnapshot] = None

class InvoiceOut(BaseModel):
    id: str
    mission_id: str
    amount: float
    status: str
    created_at: datetime
    note: Optional[str] = None
    lines_by_category: Optional[Dict[str, LineItem]] = None
    delivery_fee: Optional[float] = None
    mission: Optional[MissionSnapshot] = None

# --------- Store en mémoire ---------
INVOICES: List[InvoiceOut] = []

# --------- Helpers ---------
def get_invoice_by_mission_id(mission_id: str) -> Optional[InvoiceOut]:
    for inv in INVOICES:
        if inv.mission_id == mission_id:
            return inv
    return None

def _group_3(s: str) -> str:
    digits = re.sub(r"\D+", "", s)
    return " ".join(digits[i:i+3] for i in range(0, len(digits), 3))

def _short_id(u: str) -> str:
    base = u.replace("-", "")
    return (base[:3] + base[-3:]).upper()

def _gen_invoice_no() -> str:
    return f"F-{len(INVOICES) + 1:05d}"

def _display_invoice_no(inv_id: str) -> str:
    if re.fullmatch(r"F-\d{5}", inv_id):
        return inv_id
    return f"F-{_short_id(inv_id)}"

# ============================================================
#            GÉNÉRATION PDF — MODERN MIX (sobre)
# ============================================================

ACCENT_BG = (0.94, 0.96, 1.00)   # bleu très clair discret
BORDER    = (0.80, 0.82, 0.86)   # bordure douce
BLACK     = (0.00, 0.00, 0.00)   # texte noir

ISSUER = {
    "name": "TutelLiv",
    "addr_lines": ["10 traverse de la gaye", "13009 Marseille, France"],
    "siret_raw": "95278812300018",
    "email": "orsocarotenuto@gmail.com",
    "tel": "+33 6 24 94 43 18",
    "iban": "FR76 3000 6000 0000 0000 0000 000",
    "bic": "AGRIFRPP",
    "ape": "8299Z",
}

CAT_FR = {
    "FOOD": "Alimentaire",
    "HYGIENE": "Hygiène",
    "TOBACCO_MANDATE": "Tabac (mandat)",
    "CASH_DELIVERY": "Livraison espèces",
    "OTHER": "Autre",
}

TAX_RATE = 0.0  # TVA non applicable

# --- primitives PDF & sanitation ---
def _sanitize(text: str) -> str:
    if text is None:
        return ""
    text = (text
            .replace("’", "'").replace("‘", "'")
            .replace("“", '"').replace("”", '"')
            .replace("–", "-").replace("—", "-")
            .replace("\u00A0", " ").replace("\u202F", " ")
            .replace("œ", "oe").replace("Œ", "OE"))
    return text

def _esc(text: str) -> str:
    t = _sanitize(text)
    return t.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

def _text(x, y, s, size=11, rgb=BLACK):
    ops = f"{rgb[0]} {rgb[1]} {rgb[2]} rg\n"
    ops += f"BT /F1 {size} Tf {x} {y} Td ({_esc(s)}) Tj ET\n"
    return ops

def _rect(x, y, w, h, fill_rgb=None, stroke_rgb=None, fill=True, stroke=False):
    ops = ""
    if fill_rgb is not None:
        ops += f"{fill_rgb[0]} {fill_rgb[1]} {fill_rgb[2]} rg\n"
    if stroke_rgb is not None:
        ops += f"{stroke_rgb[0]} {stroke_rgb[1]} {stroke_rgb[2]} RG\n"
    ops += f"{x} {y} {w} {h} re\n"
    if fill and stroke:
        ops += "B\n"
    elif fill:
        ops += "f\n"
    elif stroke:
        ops += "S\n"
    return ops

def _hr(x1, x2, y):
    return f"{BLACK[0]} {BLACK[1]} {BLACK[2]} rg\n{x1} {y} {x2-x1} 1 re f\n"

def _make_pdf_bytes(draw_ops: str, pagesize=(595, 842)) -> bytes:
    w, h = pagesize
    header = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    objs = []
    objs.append(b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n")
    objs.append(b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n")
    page_obj = (
        f"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 {w} {h}] "
        f"/Resources << /Font << /F1 5 0 R >> >> "
        f"/Contents 4 0 R >> endobj\n"
    ).encode("ascii")
    objs.append(page_obj)

    stream_bytes = draw_ops.encode("cp1252", errors="strict")
    objs.append(b"4 0 obj << /Length %d >> stream\n" % len(stream_bytes) + stream_bytes + b"\nendstream endobj\n")

    font_obj = b"5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj\n"
    objs.append(font_obj)

    xref_positions, out = [], bytearray(header)
    for obj in objs:
        xref_positions.append(len(out)); out += obj
    xref_start = len(out)
    out += b"xref\n0 %d\n" % (len(objs) + 1)
    out += b"0000000000 65535 f \n"
    for pos in xref_positions:
        out += b"%010d 00000 n \n"
    out += b"trailer << /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF" % (len(objs) + 1, xref_start)
    return bytes(out)

def _fmt_eur(x: float) -> str:
    try:
        return f"{float(x):.2f} €"
    except Exception:
        return "0.00 €"

def _beneficiary_for(id_: int):
    for b in fake_beneficiaries_db:
        if int(b.id) == int(id_):
            return b
    return None

def _compute_totals(inv: InvoiceOut):
    lines = inv.lines_by_category or {}
    subtotal_ttc = 0.0
    for li in lines.values():
        try:
            subtotal_ttc += float(getattr(li, "amount", 0.0))
        except Exception:
            pass
    fee_ttc = float(inv.delivery_fee or 0.0)
    total_ttc = float(inv.amount) if inv.amount and inv.amount > 0 else round(subtotal_ttc + fee_ttc, 2)

    if TAX_RATE > 0:
        total_ht = round(total_ttc / (1 + TAX_RATE), 2)
        tva = round(total_ttc - total_ht, 2)
    else:
        total_ht = total_ttc
        tva = 0.0

    return {
        "subtotal_ttc": round(subtotal_ttc, 2),
        "fee_ttc": round(fee_ttc, 2),
        "total_ttc": round(total_ttc, 2),
        "total_ht": round(total_ht, 2),
        "tva": round(tva, 2),
    }

def _pdf_bytes_for_invoice(inv: InvoiceOut) -> bytes:
    """
    Modèle 'Modern Mix' A4 — sobre, FR, lisible, accents OK.
    """
    w, h = 595, 842
    ops = ""

    emit_date = inv.created_at or datetime.now()
    emit_str = emit_date.strftime("%d/%m/%Y")
    disp_no = _display_invoice_no(inv.id)

    ms = inv.mission
    bene = _beneficiary_for(ms.beneficiary_id) if ms else None

    # Date de livraison (si dispo)
    if ms and ms.delivered_at:
        try:
            dlv = ms.delivered_at if isinstance(ms.delivered_at, datetime) else datetime.fromisoformat(str(ms.delivered_at))
            livraison_str = dlv.strftime("%d/%m/%Y")
        except Exception:
            livraison_str = "—"
    else:
        livraison_str = "—"

    # ======= EN-TÊTE =======
    siret_display = _group_3(ISSUER["siret_raw"])
    ops += _text(24, h-40, ISSUER["name"], size=20)
    ops += _text(24, h-58, f"{ISSUER['addr_lines'][0]} • {ISSUER['addr_lines'][1]}", size=10)
    ops += _text(24, h-72, f"SIRET {siret_display} • {ISSUER['email']} • {ISSUER['tel']}", size=10)

    # Badge 'FACTURE' sobre en haut à droite, centré dans son encart
    bx, by, bw, bh = w-130, h-72, 106, 30
    ops += _rect(bx, by, bw, bh, fill_rgb=ACCENT_BG, stroke_rgb=BORDER, fill=True, stroke=True)
    label = "FACTURE"
    est_w = 0.55 * 12 * len(label)
    tx = bx + (bw - est_w) / 2
    ty = by + (bh - 12) / 2 + 2
    ops += _text(tx, ty, label, size=12)

    ops += _hr(24, w-24, h-92)

    # ======= MÉTA =======
    ops += _text(24, h-112, f"N° de facture : {disp_no}", size=11)
    ops += _text(300, h-112, f"Date d'operation : {emit_str}", size=11)
    ops += _text(300, h-128, f"Date de livraison : {livraison_str}", size=11)

    # ======= ENCADRÉ PROTÉGÉ — centrage & proportions corrigés =======
    # Centré horizontalement avec marges fixes, un poil plus bas pour équilibrer.
    margin = 48               # marge gauche/droite fixe (meilleur centrage visuel)
    cw = w - 2 * margin       # largeur du cadre
    cx = margin               # position X centrée
    ch = 78                   # hauteur légèrement augmentée
    cy = h - 218              # position Y abaissée pour “tomber” bien sous les méta

    # cadre + bordure
    ops += _rect(cx, cy, cw, ch, fill_rgb=ACCENT_BG, stroke_rgb=BORDER, fill=True, stroke=True)

    # padding & lignes
    pad = 14
    line = 16
    title_y = cy + ch - pad
    ops += _text(cx + pad, title_y, "Protégé", size=12)

    p_name = ""
    p_addr = "—"
    p_city = "—"
    p_phone = "—"
    if bene:
        p_name = f"{(bene.last_name or '').upper()} {(bene.first_name or '').strip()}".strip() or "—"
        p_addr = bene.address or "—"
        p_city = f"{(bene.postal_code or '')} {(bene.city or '')}".strip() or "—"
        p_phone = (bene.phone or "—").strip()

    ops += _text(cx + pad, title_y - line, p_name, size=11)
    ops += _text(cx + pad, title_y - 2*line, f"{p_addr} - {p_city}", size=10)
    ops += _text(cx + pad, title_y - 3*line, f"Tél. : {p_phone}", size=10)

    # ======= BLOC MISSION =======
    ms_y = cy - 22
    ops += _text(24, ms_y, "Mission", size=12)
    mission_human_id = f"Mission n° {_short_id(ms.id) if ms else _short_id(inv.mission_id)}"
    ops += _text(24, ms_y-16, mission_human_id, size=11)

    cats = list(ms.categories) if (ms and ms.categories) else []
    CAT_LABEL = {
        "FOOD": "Alimentaire",
        "HYGIENE": "Hygiène",
        "TOBACCO_MANDATE": "Tabac (mandat)",
        "CASH_DELIVERY": "Livraison espèces",
        "OTHER": "Autre",
    }
    cats_fr = [CAT_LABEL.get(c, c) for c in cats]
    cats_label = ", ".join(cats_fr) if cats_fr else "—"
    ops += _text(24, ms_y-32, f"Catégories : {cats_label}", size=11)

    # ======= TABLE LIGNES =======
    y = ms_y - 56
    ops += _hr(24, w-24, y)
    ops += _text(24, y-16, "Description", size=11)
    ops += _text(360, y-16, "Quantité", size=11)
    ops += _text(430, y-16, "PU TTC", size=11)
    ops += _text(w-110, y-16, "Montant TTC", size=11)
    ops += _hr(24, w-24, y-24)
    y -= 40

    if inv.lines_by_category and len(inv.lines_by_category) > 0:
        for cat, li in inv.lines_by_category.items():
            cat_label = CAT_LABEL.get(cat, cat)
            note = (getattr(li, "note", None) or "").strip()
            desc = f"{cat_label}" + (f" — {note}" if note else "")
            qt = "1"
            pu = float(getattr(li, "amount", 0.0) or 0.0)
            ops += _text(24, y, desc[:90], size=10)
            ops += _text(360, y, qt, size=10)
            ops += _text(430, y, _fmt_eur(pu), size=10)
            ops += _text(w-110, y, _fmt_eur(pu), size=10)
            y -= 16
    else:
        ops += _text(24, y, "Prestations de livraison et achats", size=10)
        ops += _text(360, y, "1", size=10)
        ops += _text(430, y, _fmt_eur(inv.amount or 0.0), size=10)
        ops += _text(w-110, y, _fmt_eur(inv.amount or 0.0), size=10)
        y -= 16

    if (inv.delivery_fee or 0) > 0:
        ops += _text(24, y, "Forfait de transport de valeurs", size=10)
        ops += _text(360, y, "1", size=10)
        ops += _text(430, y, _fmt_eur(inv.delivery_fee or 0.0), size=10)
        ops += _text(w-110, y, _fmt_eur(inv.delivery_fee or 0.0), size=10)
        y -= 16

    # ======= TOTAUX =======
    y -= 8
    ops += _hr(24, w-24, y)
    y -= 22
    totals = _compute_totals(inv)
    label_x = w-180
    val_x = w-100
    ops += _text(label_x, y, "Total HT :", size=11)
    ops += _text(val_x, y, _fmt_eur(totals["total_ht"]), size=11)
    y -= 16
    ops += _text(label_x, y, "TVA :", size=11)
    ops += _text(val_x, y, _fmt_eur(totals["tva"]), size=11)
    y -= 16
    ops += _text(label_x, y, "Total TTC :", size=12)
    ops += _text(val_x, y, _fmt_eur(totals["total_ttc"]), size=12)
    y -= 22
    ops += _text(label_x, y, "Net à payer :", size=12)
    ops += _text(val_x, y, _fmt_eur(totals["total_ttc"]), size=12)

    # Note
    if (inv.note or "").strip():
        y -= 28
        ops += _text(24, y, "Note :", size=11)
        y -= 16
        for line in inv.note.strip().splitlines():
            ops += _text(24, y, line[:100], size=10)
            y -= 14

    # ======= FOOTER =======
    ops += _hr(24, w-24, 90)
    ops += _text(24, 74, f"APE : {ISSUER['ape']} — IBAN : {ISSUER['iban']} — BIC : {ISSUER['bic']}", size=10)
    if TAX_RATE == 0.0:
        ops += _text(24, 60, "TVA non applicable, article 293 B du Code général des impôts", size=9)
    else:
        tva_num = ISSUER.get("tva", "")
        if tva_num:
            ops += _text(24, 60, f"N° TVA intracommunautaire : {tva_num}", size=9)
    ops += _text(24, 46, f"Paiement par virement — IBAN: {ISSUER['iban']}  •  BIC: {ISSUER['bic']}", size=10)

    return _make_pdf_bytes(ops, pagesize=(w, h))

# ============================================================

# --------- Routes ---------

@router.post("", response_model=InvoiceOut)
def create_invoice(invoice: InvoiceCreate, user=Depends(get_current_user)):
    new_invoice = InvoiceOut(
        id=_gen_invoice_no(),  # numéro simple
        mission_id=invoice.mission_id,
        amount=invoice.amount,
        status=invoice.status,
        created_at=datetime.utcnow(),
        note=invoice.note,
        lines_by_category=invoice.lines_by_category,
        delivery_fee=invoice.delivery_fee,
        mission=invoice.mission,
    )
    INVOICES.append(new_invoice)
    return new_invoice

@router.get("", response_model=List[InvoiceOut])
def list_invoices(user=Depends(get_current_user)):
    return INVOICES

@router.get("/{invoice_id}", response_model=InvoiceOut)
def get_invoice(invoice_id: str, user=Depends(get_current_user)):
    for inv in INVOICES:
        if inv.id == invoice_id:
            return inv
    raise HTTPException(status_code=404, detail="Invoice not found")

@router.put("/{invoice_id}", response_model=InvoiceOut)
def update_invoice(invoice_id: str, data: InvoiceUpdate, user=Depends(get_current_user)):
    if user.get("role") != "deliverer":
        raise HTTPException(status_code=403, detail="Seuls les livreurs peuvent modifier une facture")

    for i, inv in enumerate(INVOICES):
        if inv.id == invoice_id:
            updated = InvoiceOut(
                id=inv.id,
                mission_id=inv.mission_id,
                amount = data.amount if data.amount is not None else inv.amount,
                status = data.status if data.status is not None else inv.status,
                created_at = inv.created_at,
                note = data.note if data.note is not None else inv.note,
                lines_by_category = data.lines_by_category if data.lines_by_category is not None else inv.lines_by_category,
                delivery_fee = data.delivery_fee if data.delivery_fee is not None else inv.delivery_fee,
                mission = data.mission if data.mission is not None else inv.mission,
            )
            INVOICES[i] = updated
            return updated

    raise HTTPException(status_code=404, detail="Invoice not found")

@router.delete("/{invoice_id}")
def delete_invoice(invoice_id: str, user=Depends(get_current_user)):
    for i, inv in enumerate(INVOICES):
        if inv.id == invoice_id:
            INVOICES.pop(i)
            return {"ok": True}
    raise HTTPException(status_code=404, detail="Invoice not found")

@router.get("/{invoice_id}/pdf")
def invoice_pdf(invoice_id: str, user=Depends(get_current_user)):
    inv = next((x for x in INVOICES if x.id == invoice_id), None)
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    pdf = _pdf_bytes_for_invoice(inv)
    filename = f"invoice_{_display_invoice_no(inv.id)}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )
