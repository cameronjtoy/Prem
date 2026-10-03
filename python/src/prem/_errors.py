"""The errors the package raises. Each says what happened in words someone can act on."""

from __future__ import annotations

import builtins


class PremError(Exception):
    """Something Prem refused or couldn't do."""


class NotFoundError(PremError, LookupError):
    """No such note, file or vault."""


class LockedError(PremError):
    """The note is signed. Signed notes change only through an amendment in Prem."""


class ConflictError(PremError):
    """The note changed while this was writing to it; read it again and retry."""


class ForbiddenError(PremError, builtins.PermissionError):
    """The team server doesn't let you change (or see) this."""


class ExistsError(PremError, FileExistsError):
    """Something with that name is already there."""
