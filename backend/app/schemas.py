from typing import Optional
from datetime import datetime
from pydantic import BaseModel


# ---------- Beneficiary ----------
class BeneficiaryBase(BaseModel):
    first_name: str
    last_name: str
    address: str
    phone: Optional[str] = None
    email: Optional[str] = None


class BeneficiaryCreate(BeneficiaryBase):
    pass


class BeneficiaryRead(BeneficiaryBase):
    id: int

    class Config:
        orm_mode = True


# ---------- Mission ----------
class MissionBase(BaseModel):
    category: str
    description: Optional[str] = None
    status: Optional[str] = "pending"


class MissionCreate(MissionBase):
    beneficiary_id: int


class MissionRead(MissionBase):
    id: int
    created_at: datetime
    beneficiary_id: int

    class Config:
        orm_mode = True


# ---------- Invoice ----------
class InvoiceBase(BaseModel):
    amount: float
    status: Optional[str] = "draft"


class InvoiceCreate(InvoiceBase):
    mission_id: int


class InvoiceRead(InvoiceBase):
    id: int
    mission_id: int
    created_at: datetime

    class Config:
        orm_mode = True
