from sqlmodel import SQLModel, Field, Relationship
from typing import Optional, List
from datetime import datetime


class Beneficiary(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    first_name: str
    last_name: str
    address: str
    phone: Optional[str] = None
    email: Optional[str] = None

    # Relation : un bénéficiaire peut avoir plusieurs missions
    missions: List["Mission"] = Relationship(back_populates="beneficiary")


class Mission(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    category: str
    description: Optional[str] = None
    status: str = "pending"  # pending, in_progress, delivered
    created_at: datetime = Field(default_factory=datetime.utcnow)

    beneficiary_id: Optional[int] = Field(default=None, foreign_key="beneficiary.id")
    beneficiary: Optional[Beneficiary] = Relationship(back_populates="missions")

    invoice: Optional["Invoice"] = Relationship(back_populates="mission")


class Invoice(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    mission_id: int = Field(foreign_key="mission.id")
    amount: float
    status: str = "draft"  # draft, unpaid, paid
    created_at: datetime = Field(default_factory=datetime.utcnow)

    mission: Optional[Mission] = Relationship(back_populates="invoice")
