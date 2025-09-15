# backend/app/data_store.py
from typing import Any, List, Optional
from .routes.beneficiaries import fake_beneficiaries_db

# Stores globaux en mémoire (partagés)
MISSIONS: List[Any] = []
INVOICES: List[Any] = []

def get_invoice_by_mission_id(mission_id: str) -> Optional[Any]:
    for inv in INVOICES:
        if getattr(inv, "mission_id", None) == mission_id:
            return inv
    return None

def get_beneficiary_by_id(bene_id: int) -> Optional[Any]:
    for b in fake_beneficiaries_db:
        try:
            if int(getattr(b, "id", -1)) == int(bene_id):
                return b
        except Exception:
            pass
    return None
