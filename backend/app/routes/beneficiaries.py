from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

# Router bénéficiaires (sans slash final dans les décorateurs)
router = APIRouter(prefix="/beneficiaries", tags=["beneficiaries"])

# ----- Schéma Pydantic -----
class Beneficiary(BaseModel):
    id: int
    first_name: str
    last_name: str
    address: str
    city: Optional[str] = None
    postal_code: Optional[str] = None
    phone: Optional[str] = None
    photo_url: Optional[str] = None
    is_active: bool = True

# ----- "Base" en mémoire -----
fake_beneficiaries_db: List[Beneficiary] = []


# ----- Routes -----
@router.get("", response_model=List[Beneficiary])
def get_beneficiaries():
    return fake_beneficiaries_db

@router.post("", response_model=Beneficiary)
def create_beneficiary(beneficiary: Beneficiary):
    # Empêche les doublons par id
    for b in fake_beneficiaries_db:
        if b.id == beneficiary.id:
            raise HTTPException(status_code=400, detail="Beneficiary already exists")
    fake_beneficiaries_db.append(beneficiary)
    return beneficiary

@router.get("/{beneficiary_id}", response_model=Beneficiary)
def get_beneficiary(beneficiary_id: int):
    for b in fake_beneficiaries_db:
        if b.id == beneficiary_id:
            return b
    raise HTTPException(status_code=404, detail="Beneficiary not found")

@router.put("/{beneficiary_id}", response_model=Beneficiary)
def update_beneficiary(beneficiary_id: int, updated_beneficiary: Beneficiary):
    for i, b in enumerate(fake_beneficiaries_db):
        if b.id == beneficiary_id:
            fake_beneficiaries_db[i] = updated_beneficiary
            return updated_beneficiary
    raise HTTPException(status_code=404, detail="Beneficiary not found")

@router.delete("/{beneficiary_id}")
def delete_beneficiary(beneficiary_id: int):
    for i, b in enumerate(fake_beneficiaries_db):
        if b.id == beneficiary_id:
            del fake_beneficiaries_db[i]
            return {"message": "Beneficiary deleted"}
    raise HTTPException(status_code=404, detail="Beneficiary not found")
