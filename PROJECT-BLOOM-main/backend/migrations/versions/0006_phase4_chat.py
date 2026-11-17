"""phase 4: unified bloom chat (dm, group, studio, project)

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-16 03:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0006'
down_revision: Union[str, Sequence[str], None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'conversations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('title', sa.String(length=80), nullable=False),
        sa.Column('description', sa.String(length=300), nullable=False),
        sa.Column('avatar_media_id', sa.Integer(), nullable=True),
        sa.Column('dm_key', sa.String(length=40), nullable=True),
        sa.Column('project_id', sa.Integer(), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['avatar_media_id'], ['media.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('dm_key'),
        sa.UniqueConstraint('project_id'),
    )
    with op.batch_alter_table('conversations', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_conversations_kind'), ['kind'], unique=False)

    op.create_table(
        'conversation_members',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('conversation_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('role', sa.String(length=12), nullable=False),
        sa.Column('last_read_message_id', sa.Integer(), nullable=True),
        sa.Column('joined_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('conversation_id', 'user_id', name='uq_conversation_member'),
    )
    with op.batch_alter_table('conversation_members', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_conversation_members_conversation_id'), ['conversation_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_conversation_members_user_id'), ['user_id'], unique=False)

    op.create_table(
        'messages',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('conversation_id', sa.Integer(), nullable=False),
        sa.Column('sender_id', sa.Integer(), nullable=True),
        sa.Column('reply_to_id', sa.Integer(), nullable=True),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('media_id', sa.Integer(), nullable=True),
        sa.Column('shared_ref', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['media_id'], ['media.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['reply_to_id'], ['messages.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['sender_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.create_index('ix_messages_conv_id_id', ['conversation_id', 'id'], unique=False)
        batch_op.create_index(batch_op.f('ix_messages_conversation_id'), ['conversation_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_messages_media_id'), ['media_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_messages_sender_id'), ['sender_id'], unique=False)

    op.create_table(
        'message_reactions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('message_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['message_id'], ['messages.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('message_id', 'user_id', name='uq_msg_reaction_user'),
    )
    with op.batch_alter_table('message_reactions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_message_reactions_message_id'), ['message_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_message_reactions_user_id'), ['user_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('message_reactions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_message_reactions_user_id'))
        batch_op.drop_index(batch_op.f('ix_message_reactions_message_id'))
    op.drop_table('message_reactions')

    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_messages_sender_id'))
        batch_op.drop_index(batch_op.f('ix_messages_media_id'))
        batch_op.drop_index(batch_op.f('ix_messages_conversation_id'))
        batch_op.drop_index('ix_messages_conv_id_id')
    op.drop_table('messages')

    with op.batch_alter_table('conversation_members', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_conversation_members_user_id'))
        batch_op.drop_index(batch_op.f('ix_conversation_members_conversation_id'))
    op.drop_table('conversation_members')

    with op.batch_alter_table('conversations', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_conversations_kind'))
    op.drop_table('conversations')
