"""Initial schema: shared projects (JSONB + PostGIS extent) and audit log.

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-19
"""

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry
from sqlalchemy.dialects import postgresql

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.create_table(
        "shared_projects",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("edit_token_hash", sa.String(128), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("fictional", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("document", postgresql.JSONB(), nullable=False),
        sa.Column("extent", Geometry("POLYGON", srid=4326, spatial_index=False), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("idx_shared_projects_extent", "shared_projects", ["extent"], postgresql_using="gist")
    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("project_id", sa.String(32), nullable=False),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("client", sa.String(32), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_audit_log_project_id", "audit_log", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_audit_log_project_id", table_name="audit_log")
    op.drop_table("audit_log")
    op.drop_index("idx_shared_projects_extent", table_name="shared_projects")
    op.drop_table("shared_projects")
