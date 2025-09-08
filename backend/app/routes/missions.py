# backend/app/routes/missions.py
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from datetime import datetime
import uuid

# import de la "base" factures pour créer / mettre à jour automatiquement
from .invoices import INVOICES, InvoiceOut, get_invoice_by_mission_id
# import auth
from .auth import get_current_user

router = APIRouter(prefix="/missions", tags=["missions"])

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
    # legacy pour compat front
    category: Optional[str] = None
    comment: Optional[str] = None
    status: str
    created_at: datetime

MISSIONS: List[MissionOut] = []

@router.post("", response_model=MissionOut)
def create_mission(mission: MissionCreate, user=Depends(get_current_user)):
    if not mission.categories:
        raise HTTPException(status_code=400, detail="Au moins une catégorie est requise")

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
        created_at=datetime.utcnow(),
    )
    MISSIONS.append(item)

    # ✅ Auto-crée une facture liée en "editing"
    INVOICES.append(
        InvoiceOut(
            id=str(uuid.uuid4()),
            mission_id=item.id,
            amount=0.0,
            status="editing",           # en attente d'édition jusqu'à livraison
            created_at=datetime.utcnow(),
        )
    )

    return item

@router.get("", response_model=List[MissionOut])
def list_missions(user=Depends(get_current_user)):
    return MISSIONS

@router.get("/{mission_id}", response_model=MissionOut)
def get_mission(mission_id: str, user=Depends(get_current_user)):
    for ms in MISSIONS:
        if ms.id == mission_id:
            return ms
    raise HTTPException(status_code=404, detail="Mission not found")

@router.put("/{mission_id}", response_model=MissionOut)
def update_mission(mission_id: str, data: MissionCreate, user=Depends(get_current_user)):
    for i, ms in enumerate(MISSIONS):
        if ms.id == mission_id:
            # ⚠️ règle métier : seul un LIVREUR peut changer le statut
            if data.status != ms.status and user.get("role") != "deliverer":
                raise HTTPException(status_code=403, detail="Seuls les livreurs peuvent changer le statut d'une mission")

            # garde-fou : contenu modifiable seulement si mission en attente
            if ms.status != "pending" and (data.categories != ms.categories or data.general_comment != ms.general_comment or data.comments_by_category != ms.comments_by_category):
                raise HTTPException(status_code=409, detail="Seules les missions 'pending' peuvent être modifiées")

            if not data.categories:
                raise HTTPException(status_code=400, detail="Au moins une catégorie est requise")

            first_cat = data.categories[0]
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
            )
            MISSIONS[i] = updated

            # ✅ Si la mission passe à "delivered", passer la facture à "pending"
            if ms.status != "delivered" and updated.status == "delivered":
                inv = get_invoice_by_mission_id(ms.id)
                if inv:
                    idx = INVOICES.index(inv)
                    INVOICES[idx] = InvoiceOut(
                        id=inv.id,
                        mission_id=inv.mission_id,
                        amount=inv.amount,
                        status="pending",  # facture en attente après livraison
                        created_at=inv.created_at,
                    )

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
            return {"ok": True}
    raise HTTPException(status_code=404, detail="Mission not found")
