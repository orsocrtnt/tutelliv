# backend/app/database.py

from sqlmodel import SQLModel, create_engine, Session

# URL de connexion à la base de données (ici SQLite locale pour commencer)
DATABASE_URL = "sqlite:///./tutelliv.db"

# Création du moteur
engine = create_engine(DATABASE_URL, echo=True)

# Fonction pour créer les tables
def init_db():
    SQLModel.metadata.create_all(engine)

# Dépendance pour obtenir une session DB
def get_session():
    with Session(engine) as session:
        yield session
