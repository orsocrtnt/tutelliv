# backend/app/routes/missions.py
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from datetime import datetime, timedelta, timezone
import uuid

# ✅ évite les imports circulaires avec invoices.py (on importe seulement les structures nécessaires)
from ..events import publish_event  # ✅ NEW
from .invoices import INVOICES, InvoiceOut, get_invoice_by_mission_id, MissionSnapshot
from .auth import get_current_user

router = APIRouter(prefix="/missions", tags=["missions"])

# ---------- Helpers jours ouvrés ----------
def _is_weekend(d: datetime) -> bool:
    # 0=lundi ... 6=dimanche
    return d.weekday() >= 5  # 5=sam, 6=dim

def _date_only(dt: datetime) -> datetime:
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)

def _next_business_day(dt: datetime) -> datetime:
    d = _date_only(dt)
    while _is_weekend(d):
        d += timedelta(days=1)
    return d

def _prev_business_day(dt: datetime) -> datetime:
    d = _date_only(dt)
    while _is_weekend(d):
        d -= timedelta(days=1)
    return d

def _add_business_days(dt: datetime, n: int) -> datetime:
    """
    Ajoute n jours ouvrés à dt (dt supposé normalisé à 00:00).
    Renvoie une date à 00:00.
    """
    d = _date_only(dt)
    added = 0
    while added < n:
        d += timedelta(days=1)
        if not _is_weekend(d):
            added += 1
    return d

def _initial_3bd_slot(created_at: datetime) -> Dict[str, str]:
    """
    Créneau initial : 3 jours ouvrés (all-day, end exclusif)
      - start = prochain jour ouvré 00:00
      - end   = start + 3 jours ouvrés (exclusif)
    """
    start_day = _next_business_day(created_at)
    end_excl = _add_business_days(start_day, 3)
    return {
        "calendar_start": start_day.isoformat(),
        "calendar_end": end_excl.isoformat(),
    }

def _dynamic_end_for_in_progress(now_utc: datetime) -> datetime:
    """
    Renvoie l'end EXCLUSIF correspondant au DERNIER jour ouvré écoulé (inclus).
    - si on est un jour ouvré, end = (aujourd'hui 00:00) + 1 jour
    - si on est week-end, end = (dernier jour ouvré 00:00) + 1 jour
    """
    today = _date_only(now_utc)
    last_bd = today if not _is_weekend(today) else _prev_business_day(today)
    end_excl = last_bd + timedelta(days=1)
    return end_excl

# --- Schémas ---
class MissionCreate(BaseModel):
    beneficiary_id: int
    categories: List[str] = Field(default_factory=list)
    comments_by_category: Optional[Dict[str, str]] = None
    general_comment: Optional[str] = None
    status: str = "pending"  # pending | in_progress | delivered

class MissionOut(BaseModel):
    id: str
    beneficiary_id: int
    categories: List[str]
    comments_by_category: Optional[Dict[str, str]] = None
    general_comment: Optional[str] = None
    # compat pour l'ancien front
    category: Optional[str] = None
    comment: Optional[str] = None
    status: str
    created_at: datetime
    # créneau all-day ISO (end exclusif)
    calendar_start: Optional[str] = None
    calendar_end: Optional[str] = None
    # horodatage de livraison (pour figer end)
    delivered_at: Optional[datetime] = None

# --------- Store en mémoire ---------
MISSIONS: List[MissionOut] = []

@router.post("", response_model=MissionOut)
def create_mission(mission: MissionCreate, user=Depends(get_current_user)):
    if not mission.categories:
        raise HTTPException(status_code=400, detail="Au moins une catégorie est requise")

    # On stocke en naive UTC (cohérent avec le reste du code)
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # ✅ Créneau initial de 3 jours ouvrés
    slot = _initial_3bd_slot(now)

    first_cat = mission.categories[0]
    item = MissionOut(
        id=str(uuid.uuid4()),
        beneficiary_id=mission.beneficiary_id,
        categories=mission.categories,
        comments_by_category=mission.comments_by_category or None,
        general_comment=mission.general_comment or None,
        category=first_cat,
        comment=mission.general_comment or None,
        status=mission.status,
        created_at=now,
        calendar_start=slot["calendar_start"],
        calendar_end=slot["calendar_end"],  # end initial = 3 jours ouvrés
        delivered_at=None,
    )
    MISSIONS.append(item)

    # ✅ Auto-crée une facture liée en "editing" avec snapshot mission
    snapshot = MissionSnapshot(
        id=item.id,
        beneficiary_id=item.beneficiary_id,
        categories=list(item.categories),
        created_at=item.created_at,
        calendar_start=item.calendar_start,
        calendar_end=item.calendar_end,
        delivered_at=None,
    )
    INVOICES.append(
        InvoiceOut(
            id=str(uuid.uuid4()),
            mission_id=item.id,
            amount=0.0,
            status="editing",
            created_at=now,
            note=None,
            lines_by_category=None,
            delivery_fee=None,
            mission=snapshot,
        )
    )

    # ✅ push event
    publish_event("mission.created", item.model_dump())
    return item

def _with_dynamic_end(ms: MissionOut) -> MissionOut:
    """
    Renvoie une copie de ms avec calendar_end ajusté dynamiquement si non livrée.
    Règle :
      - delivered  → on conserve le end figé (et on backfill si besoin).
      - sinon      → end = max(end_stocké, end_dynamique_calculé_sur_jours_ouvrés)
    """
    # Backfill start si manquant (sécurité)
    start = None
    if ms.calendar_start:
        start = _date_only(datetime.fromisoformat(ms.calendar_start))
    else:
        start = _next_business_day(ms.created_at)

    if ms.status == "delivered":
        # end doit être figé au jour de livraison (excl.)
        if ms.calendar_end:
            return ms
        # backfill si jamais calendar_end n'avait pas été posé lors de la livraison
        if ms.delivered_at:
            end_excl = _date_only(ms.delivered_at) + timedelta(days=1)
        else:
            # fallback extrême : au moins 1 jour après le start
            end_excl = start + timedelta(days=1)
        return MissionOut(**{**ms.model_dump(), "calendar_end": end_excl.isoformat()})

    # Non livrée → calcul dynamique
    dyn_end = _dynamic_end_for_in_progress(datetime.utcnow())

    # end stocké = valeur actuelle (souvent l'initial 3 jours)
    if ms.calendar_end:
        stored_end = _date_only(datetime.fromisoformat(ms.calendar_end))
    else:
        # si absent, on part sur start + 1 jour mini
        stored_end = start + timedelta(days=1)

    # end final = max(stored_end, dyn_end)
    final_end = dyn_end if dyn_end > stored_end else stored_end

    return MissionOut(**{**ms.model_dump(), "calendar_end": final_end.isoformat()})

@router.get("", response_model=List[MissionOut])
def list_missions(user=Depends(get_current_user)):
    out: List[MissionOut] = []
    for ms in MISSIONS:
        # Backfill start si manquant
        if not ms.calendar_start:
            ms = MissionOut(**{
                **ms.model_dump(),
                "calendar_start": _next_business_day(ms.created_at).isoformat()
            })
        out.append(_with_dynamic_end(ms))
    return out

@router.get("/{mission_id}", response_model=MissionOut)
def get_mission(mission_id: str, user=Depends(get_current_user)):
    for ms in MISSIONS:
        if ms.id == mission_id:
            if not ms.calendar_start:
                ms = MissionOut(**{
                    **ms.model_dump(),
                    "calendar_start": _next_business_day(ms.created_at).isoformat()
                })
            return _with_dynamic_end(ms)
    raise HTTPException(status_code=404, detail="Mission not found")

@router.put("/{mission_id}", response_model=MissionOut)
def update_mission(mission_id: str, data: MissionCreate, user=Depends(get_current_user)):
    for i, ms in enumerate(MISSIONS):
        if ms.id == mission_id:
            # ⚠️ règle métier : seul un LIVREUR peut changer le statut
            if data.status != ms.status and user.get("role") != "deliverer":
                raise HTTPException(status_code=403, detail="Seuls les livreurs peuvent changer le statut d'une mission")

            # garde-fou : contenu modifiable seulement si mission en attente
            if ms.status != "pending" and (
                data.categories != ms.categories
                or (data.general_comment or None) != (ms.general_comment or None)
                or (data.comments_by_category or None) != (ms.comments_by_category or None)
            ):
                raise HTTPException(status_code=409, detail="Seules les missions 'pending' peuvent être modifiées")

            if not data.categories:
                raise HTTPException(status_code=400, detail="Au moins une catégorie est requise")

            first_cat = data.categories[0]

            delivered_at = ms.delivered_at
            calendar_end = ms.calendar_end

            # ✅ Si on passe à "delivered" → fige end au jour de livraison (exclusif)
            if ms.status != "delivered" and data.status == "delivered":
                now = datetime.utcnow()
                delivered_at = now
                end_excl = _date_only(now) + timedelta(days=1)
                calendar_end = end_excl.isoformat()

            updated = MissionOut(
                id=ms.id,
                beneficiary_id=data.beneficiary_id,
                categories=data.categories,
                comments_by_category=data.comments_by_category or None,
                general_comment=data.general_comment or None,
                category=first_cat,
                comment=data.general_comment or None,
                status=data.status or ms.status,
                created_at=ms.created_at,
                calendar_start=ms.calendar_start,
                calendar_end=calendar_end,  # peut être figé si delivered
                delivered_at=delivered_at,
            )
            MISSIONS[i] = updated

            # ✅ Met à jour la facture liée et passe à "pending" si livré
            inv = get_invoice_by_mission_id(ms.id)
            if inv:
                # rafraîchir également le snapshot de mission dans la facture
                snap = inv.mission or MissionSnapshot(
                    id=updated.id,
                    beneficiary_id=updated.beneficiary_id,
                    categories=list(updated.categories),
                    created_at=updated.created_at,
                )
                snap.calendar_start = updated.calendar_start
                snap.calendar_end = updated.calendar_end
                snap.delivered_at = updated.delivered_at

                INVOICES[INVOICES.index(inv)] = InvoiceOut(
                    id=inv.id,
                    mission_id=inv.mission_id,
                    amount=inv.amount,
                    status=("pending" if (ms.status != "delivered" and updated.status == "delivered") else inv.status),
                    created_at=inv.created_at,
                    note=inv.note,
                    lines_by_category=inv.lines_by_category,
                    delivery_fee=inv.delivery_fee,
                    mission=snap,
                )

            # ✅ push event
            publish_event("mission.updated", updated.model_dump())
            return updated
    raise HTTPException(status_code=404, detail="Mission not found")

@router.delete("/{mission_id}")
def delete_mission(mission_id: str, user=Depends(get_current_user)):
    for i, ms in enumerate(MISSIONS):
        if ms.id == mission_id:
            # (optionnel) supprime la facture liée
            inv = get_invoice_by_mission_id(ms.id)
            if inv:
                INVOICES.remove(inv)
            MISSIONS.pop(i)
            # ✅ push event
            publish_event("mission.deleted", {"id": mission_id})
            return {"ok": True}
    raise HTTPException(status_code=404, detail="Mission not found")
