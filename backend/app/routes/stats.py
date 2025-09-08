# backend/app/routes/stats.py
from fastapi import APIRouter
from datetime import datetime, timedelta

# Stores en mémoire existants
from .missions import MISSIONS  # List[MissionOut]
from .invoices import INVOICES  # List[InvoiceOut]

router = APIRouter(prefix="/stats", tags=["stats"])

@router.get("")
def get_stats():
    """
    Agrégats pour le tableau de bord.
    - missions_in_progress : missions 'pending' ou 'in_progress'
    - beneficiaries_active : nb de bénéficiaires distincts avec mission créée < 30 jours
    - invoices_pending     : factures en attente de règlement -> statut 'pending'
    """
    now = datetime.utcnow()
    last_30d = now - timedelta(days=30)

    # Missions en cours
    in_progress_statuses = {"pending", "in_progress"}
    missions_in_progress = sum(1 for m in MISSIONS if m.status in in_progress_statuses)

    # Bénéficiaires actifs (ayant eu une mission créée dans les 30 derniers jours)
    bene_ids_last_30d = {
        m.beneficiary_id for m in MISSIONS
        if m.created_at and m.created_at >= last_30d
    }
    beneficiaries_active = len(bene_ids_last_30d)

    # ✅ Factures en attente = statut 'pending'
    invoices_pending = sum(1 for inv in INVOICES if getattr(inv, "status", None) == "pending")

    return {
        "missions_in_progress": missions_in_progress,
        "beneficiaries_active": beneficiaries_active,
        "invoices_pending": invoices_pending,
        "generated_at": now.isoformat(),
    }
