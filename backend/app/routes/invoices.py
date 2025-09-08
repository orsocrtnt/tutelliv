# backend/app/routes/invoices.py
from fastapi import APIRouter, HTTPException, Depends, Response
from pydantic import BaseModel
from typing import List, Optional, Dict
from datetime import datetime
import uuid

from .auth import get_current_user

router = APIRouter(prefix="/invoices", tags=["invoices"])

# --------- Modèles ---------

class LineItem(BaseModel):
    amount: float = 0.0
    note: Optional[str] = None  # string (corrige 422)

class InvoiceCreate(BaseModel):
    mission_id: str
    amount: float = 0.0
    status: str = "editing"  # editing | pending | paid
    note: Optional[str] = None

    # détail par catégorie + frais de livraison
    lines_by_category: Optional[Dict[str, LineItem]] = None
    delivery_fee: Optional[float] = None

class InvoiceUpdate(BaseModel):
    """Mise à jour partielle"""
    amount: Optional[float] = None
    status: Optional[str] = None
    note: Optional[str] = None
    lines_by_category: Optional[Dict[str, LineItem]] = None
    delivery_fee: Optional[float] = None

class InvoiceOut(BaseModel):
    id: str
    mission_id: str
    amount: float
    status: str
    created_at: datetime
    note: Optional[str] = None
    lines_by_category: Optional[Dict[str, LineItem]] = None
    delivery_fee: Optional[float] = None

# --------- Store en mémoire ---------
INVOICES: List[InvoiceOut] = []

# --------- Helpers ---------
def get_invoice_by_mission_id(mission_id: str) -> Optional[InvoiceOut]:
    for inv in INVOICES:
        if inv.mission_id == mission_id:
            return inv
    return None

def _pdf_bytes_for_invoice(inv: InvoiceOut) -> bytes:
    """
    Génère un PDF très simple (1 page, texte) sans dépendance externe.
    NB: c'est minimaliste mais valide pour un téléchargement MVP.
    """
    # Contenu texte simplifié
    lines = [
        f"FACTURE #{inv.id}",
        f"Mission: {inv.mission_id}",
        f"Statut: {inv.status}",
        f"Montant total: {inv.amount:.2f} EUR",
        f"Frais de livraison: {inv.delivery_fee if inv.delivery_fee is not None else 0:.2f} EUR",
        f"Note: {inv.note or ''}",
        "---- Détails par catégorie ----",
    ]
    if inv.lines_by_category:
        for k, li in inv.lines_by_category.items():
            lines.append(f"{k}: {li.amount:.2f} EUR  | {li.note or ''}")
    else:
        lines.append("(aucun détail)")

    # PDF minimal (police Helvetica intégrée par les lecteurs)
    # On écrit chaque ligne à 720,700,680,... (top-down)
    y = 750
    step = 16
    content_stream = "BT /F1 12 Tf 50 {} Td ({}) Tj ET"
    pdf_lines = []
    for text in lines:
      # échappe les parenthèses
      safe = text.replace("(", "\\(").replace(")", "\\)")
      pdf_lines.append(content_stream.format(y, safe))
      y -= step

    pdf_body = "\n".join(pdf_lines).encode("latin-1", errors="ignore")

    # Objets PDF
    header = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    objs = []

    # 1) Catalog
    objs.append(b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n")
    # 2) Pages
    objs.append(b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n")
    # 3) Page
    objs.append(
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 5 0 R >> >> "
        b"/Contents 4 0 R >> endobj\n"
    )
    # 4) Contents (stream)
    stream = b"4 0 obj << /Length %d >> stream\n%s\nendstream endobj\n" % (len(pdf_body), pdf_body)
    objs.append(stream)
    # 5) Font
    objs.append(b"5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n")

    # xref
    xref_positions = []
    out = bytearray()
    out += header
    for obj in objs:
        xref_positions.append(len(out))
        out += obj
    xref_start = len(out)
    out += b"xref\n0 %d\n" % (len(objs) + 1)
    out += b"0000000000 65535 f \n"
    for pos in xref_positions:
        out += b"%010d 00000 n \n" % pos
    out += b"trailer << /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF" % (len(objs) + 1, xref_start)
    return bytes(out)

# --------- Routes ---------

@router.post("", response_model=InvoiceOut)
def create_invoice(invoice: InvoiceCreate, user=Depends(get_current_user)):
    new_invoice = InvoiceOut(
        id=str(uuid.uuid4()),
        mission_id=invoice.mission_id,
        amount=invoice.amount,
        status=invoice.status,
        created_at=datetime.utcnow(),
        note=invoice.note,
        lines_by_category=invoice.lines_by_category,
        delivery_fee=invoice.delivery_fee,
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
    # Seuls les livreurs peuvent modifier une facture
    if user.get("role") != "deliverer":
        raise HTTPException(status_code=403, detail="Seuls les livreurs peuvent modifier une facture")

    for i, inv in enumerate(INVOICES):
        if inv.id == invoice_id:
            updated = InvoiceOut(
                id=inv.id,
                mission_id=inv.mission_id,  # mission_id figé
                amount = data.amount if data.amount is not None else inv.amount,
                status = data.status if data.status is not None else inv.status,
                created_at = inv.created_at,
                note = data.note if data.note is not None else inv.note,
                lines_by_category = data.lines_by_category if data.lines_by_category is not None else inv.lines_by_category,
                delivery_fee = data.delivery_fee if data.delivery_fee is not None else inv.delivery_fee,
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

# ✅ PDF (livreur & MJPM — auth par token ou cookie)
@router.get("/{invoice_id}/pdf")
def invoice_pdf(invoice_id: str, user=Depends(get_current_user)):
    inv = next((x for x in INVOICES if x.id == invoice_id), None)
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    pdf = _pdf_bytes_for_invoice(inv)
    filename = f"invoice_{invoice_id}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )
