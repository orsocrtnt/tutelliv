# backend/app/services/estimate.py
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Dict

router = APIRouter(prefix="/estimate", tags=["estimate"])

# --- Models ---
class Item(BaseModel):
    name: str
    quantity: int
    unit_price: float

class EstimateResponse(BaseModel):
    subtotal: float
    margin: float
    delivery_fee: float
    tva: float
    total: float

# --- Service d'estimation ---
def calculate_estimate(items: List[Dict]) -> Dict:
    subtotal = sum(item["quantity"] * item["unit_price"] for item in items)
    delivery_fee = 5.0  # forfait livraison
    margin = subtotal * 0.1  # marge de 10%
    tva = (subtotal + margin + delivery_fee) * 0.2  # TVA 20%
    total = subtotal + margin + delivery_fee + tva

    return {
        "subtotal": round(subtotal, 2),
        "margin": round(margin, 2),
        "delivery_fee": round(delivery_fee, 2),
        "tva": round(tva, 2),
        "total": round(total, 2),
    }

# --- Endpoint ---
@router.post("", response_model=EstimateResponse)
def estimate(items: List[Item]):
    return calculate_estimate([item.dict() for item in items])
