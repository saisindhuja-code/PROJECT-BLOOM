"""phase 3: follows, reactions, persistent notifications and preferences

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-16 02:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0005'
down_revision: Union[str, Sequence[str], None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('notification_preferences', sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
        )

    op.create_table(
        'follows',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('follower_id', sa.Integer(), nullable=False),
        sa.Column('following_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['follower_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['following_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('follower_id', 'following_id', name='uq_follow_pair'),
    )
    with op.batch_alter_table('follows', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_follows_follower_id'), ['follower_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_follows_following_id'), ['following_id'], unique=False)

    op.create_table(
        'reactions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('target_type', sa.String(length=16), nullable=False),
        sa.Column('target_id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'target_type', 'target_id', name='uq_reaction_user_target'),
    )
    with op.batch_alter_table('reactions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_reactions_user_id'), ['user_id'], unique=False)
        batch_op.create_index('ix_reactions_target', ['target_type', 'target_id'], unique=False)

    op.create_table(
        'notifications',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('actor_id', sa.Integer(), nullable=True),
        sa.Column('kind', sa.String(length=24), nullable=False),
        sa.Column('title', sa.String(length=120), nullable=False),
        sa.Column('body', sa.String(length=300), nullable=False),
        sa.Column('link', sa.String(length=200), nullable=False),
        sa.Column('target_type', sa.String(length=24), nullable=True),
        sa.Column('target_id', sa.String(length=48), nullable=True),
        sa.Column('is_read', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('notifications', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_notifications_user_id'), ['user_id'], unique=False)
        batch_op.create_index('ix_notifications_user_read_created', ['user_id', 'is_read', 'created_at'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('notifications', schema=None) as batch_op:
        batch_op.drop_index('ix_notifications_user_read_created')
        batch_op.drop_index(batch_op.f('ix_notifications_user_id'))
    op.drop_table('notifications')

    with op.batch_alter_table('reactions', schema=None) as batch_op:
        batch_op.drop_index('ix_reactions_target')
        batch_op.drop_index(batch_op.f('ix_reactions_user_id'))
    op.drop_table('reactions')

    with op.batch_alter_table('follows', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_follows_following_id'))
        batch_op.drop_index(batch_op.f('ix_follows_follower_id'))
    op.drop_table('follows')

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('notification_preferences')
