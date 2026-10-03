"""Write to your Prem lab notebook from Python.

    import prem

    entry = prem.connect().entry("Ligation of insert into pUC19")
    entry.attach(fig)                      # a matplotlib figure, saved as PNG next to the note
    entry.attach(df, name="counts.csv")    # a pandas DataFrame, saved as CSV
    entry.record("Colonies", 84)           # a row in the note's Results table
    entry.tables()                         # every table in the note, as DataFrames

``connect()`` opens a vault folder on this computer or a Prem team server. On a team server your
permissions apply and each change is recorded under your name. In a local vault, Prem records the
change in the note's history as an edit made outside Prem. Signed notes are never changed.
"""

from __future__ import annotations

import io
import os
import posixpath
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from . import _markdown as md
from ._backends import PREM_FOLDER, Backend, LocalBackend, RemoteBackend
from ._errors import ConflictError, ExistsError, ForbiddenError, LockedError, NotFoundError, PremError

__version__ = "0.1.0"

__all__ = [
    "connect",
    "Vault",
    "Entry",
    "attach",
    "record",
    "tables",
    "PremError",
    "NotFoundError",
    "LockedError",
    "ConflictError",
    "ForbiddenError",
    "ExistsError",
    "__version__",
]

PathLike = Union[str, "os.PathLike[str]"]


def connect(target: Optional[PathLike] = None, token: Optional[str] = None) -> "Vault":
    """Opens a vault.

    ``target`` is a vault folder or a team server's address (``https://…``). Without one, Prem uses
    ``$PREM_VAULT``, or else the vault the current folder is in, which is where analysis cells run.
    A team server needs your access token: pass ``token`` or set ``$PREM_TOKEN``.
    """
    where = os.fspath(target) if target is not None else os.environ.get("PREM_VAULT", "")
    if where.startswith(("http://", "https://")):
        token = token or os.environ.get("PREM_TOKEN")
        if not token:
            raise ForbiddenError("A team server needs your access token: connect(url, token=…) or set PREM_TOKEN.")
        return Vault(RemoteBackend(where, token))
    if where:
        root = Path(where).expanduser()
        if not root.is_dir():
            raise NotFoundError(f"There's no folder at {root}")
        return Vault(LocalBackend(root))
    here = Path.cwd().resolve()
    for folder in (here, *here.parents):
        if (folder / PREM_FOLDER).is_dir():
            return Vault(LocalBackend(folder))
    raise NotFoundError(
        f"{here} isn't inside a Prem vault. Pass the vault's folder or server address: prem.connect('…')."
    )


class Vault:
    """A Prem vault: a folder of notes on this computer, or a team server."""

    def __init__(self, backend: Backend):
        self._backend = backend

    @property
    def name(self) -> str:
        return self._backend.name

    @property
    def location(self) -> str:
        """The vault's folder, or the server's address."""
        return self._backend.location

    def __repr__(self) -> str:
        return f"<prem.Vault {self.name!r} at {self.location}>"

    def entry(self, name: str) -> "Entry":
        """A note, by its path in the vault (``Notebook/2026/Gel run``) or by its title (``Gel run`` or ``[[Gel run]]``)."""
        name = name.strip()
        if name.startswith("[[") and name.endswith("]]"):
            name = name[2:-2].split("|")[0].split("#")[0].strip()
        path = md.normalize_path(name if name.lower().endswith(".md") else name + ".md")
        notes = [p for p in self._backend.files() if p.lower().endswith(".md")]
        exact = [p for p in notes if p.lower() == path.lower()]
        if exact:
            return Entry(self, exact[0])
        if "/" not in path:
            title = md.note_title(path).lower()
            matches = [p for p in notes if md.note_title(p).lower() == title and not p.startswith("templates/")]
            if len(matches) == 1:
                return Entry(self, matches[0])
            if len(matches) > 1:
                raise NotFoundError(f'More than one note is called "{name}": {", ".join(matches)}. Use its path.')
        raise NotFoundError(f'There\'s no note "{name}" in {self.name}')

    def notes(self, folder: str = "", type: Optional[str] = None) -> List["Entry"]:
        """Every note (under ``folder``, if given), optionally only those whose frontmatter says ``type: …``."""
        prefix = md.normalize_path(folder)
        found = []
        for path in self._backend.files():
            if not path.lower().endswith(".md") or path.startswith("templates/"):
                continue
            if prefix and not path.startswith(prefix + "/"):
                continue
            entry = Entry(self, path)
            if type is None or entry.fields.get("type") == type:
                found.append(entry)
        return found


class Entry:
    """One note in a vault. Reads always fetch the latest text; writes check nothing changed in between."""

    def __init__(self, vault: Vault, path: str):
        self.vault = vault
        self.path = path

    def __repr__(self) -> str:
        return f"<prem.Entry {self.path!r}>"

    @property
    def title(self) -> str:
        return md.note_title(self.path)

    @property
    def text(self) -> str:
        """The note's markdown."""
        return self.vault._backend.read(self.path)[0]

    @property
    def fields(self) -> Dict[str, str]:
        """The note's frontmatter (``type``, ``status``, …)."""
        return md.parse_frontmatter(self.text).fields

    @property
    def locked(self) -> bool:
        """Whether the note is signed, so it can't be changed from here."""
        return self.vault._backend.locked(self.path)

    def _edit(self, change) -> None:
        backend = self.vault._backend
        text, version = backend.read(self.path)
        backend.write(self.path, change(text), version)

    def _check_writable(self) -> None:
        if self.locked:
            raise LockedError(f"{self.path} is signed. Change it in Prem with Amend, which records why.")

    def attach(self, obj: Any, name: Optional[str] = None, under: Optional[str] = None) -> str:
        """Saves a figure, table or file next to the note and adds it to the note. Returns its path in the vault.

        ``obj`` may be a matplotlib figure (saved as PNG), a pandas DataFrame or Series (saved as CSV), a path
        to a file, or bytes (with a ``name``). It goes at the end of the note, or at the end of the
        ``## under`` section. If the name is taken, a number is added, as Prem does."""
        data, default_name = _to_bytes(obj, name)
        if len(data) > md.MAX_ATTACHMENT_BYTES:
            raise PremError(f'"{default_name}" is larger than {md.MAX_ATTACHMENT_BYTES // 1024 // 1024} MB')
        self._check_writable()
        file_name = md.attachment_file_name(default_name)
        folder = md.attachment_folder(self.path)
        for n in range(1000):
            path = posixpath.join(folder, md.numbered_name(file_name, n))
            try:
                self.vault._backend.write_new_binary(path, data)
                break
            except ExistsError:
                continue
        else:
            raise ExistsError(f'Could not find a free name for "{file_name}"')
        link = md.attachment_markdown(self.path, path)
        self._edit(lambda text: md.append_block(text, link, under))
        return path

    def record(self, measurement: str, value: Any, unit: str = "", note: str = "", replace: bool = True) -> None:
        """Puts a result in the note's ``## Results`` table, creating the table if needed.

        A row with the same measurement is updated, unless ``replace=False``, which adds another row."""
        self._check_writable()
        self._edit(lambda text: md.record_result(text, measurement, value, unit, note, replace))

    def append(self, markdown: str, under: Optional[str] = None) -> None:
        """Adds markdown at the end of the note, or at the end of the ``## under`` section."""
        self._check_writable()
        self._edit(lambda text: md.append_block(text, markdown.strip("\n"), under))

    def tables(self) -> Dict[str, Any]:
        """Every table in the note, keyed by the heading it's under. DataFrames if pandas is installed,
        otherwise lists of dicts. Numbers come back as numbers."""
        result: Dict[str, Any] = {}
        for heading, table in md.headed_tables(self.text):
            key = heading or self.title
            n = 2
            while key in result:
                key = f"{heading or self.title} ({n})"
                n += 1
            result[key] = _frame(table)
        return result

    def table(self, heading: str = md.RESULTS_HEADING) -> Any:
        """The first table under ``heading`` (Results by default)."""
        for key, value in self.tables().items():
            if key.lower() == heading.lower():
                return value
        raise NotFoundError(f'{self.path} has no table under "{heading}"')

    def read_file(self, path: str) -> bytes:
        """The bytes of an attachment, by its path relative to the note (``attachments/plate.csv``)."""
        base = md.dirname(self.path)
        return self.vault._backend.read_binary(md.normalize_path(posixpath.join(base, path) if base else path))


def _to_bytes(obj: Any, name: Optional[str]):
    if hasattr(obj, "savefig"):  # a matplotlib Figure
        buffer = io.BytesIO()
        obj.savefig(buffer, format=_figure_format(name), dpi=150, bbox_inches="tight")
        return buffer.getvalue(), name or "figure.png"
    if hasattr(obj, "to_csv"):  # a pandas DataFrame or Series
        index = type(getattr(obj, "index", None)).__name__ != "RangeIndex"
        return obj.to_csv(index=index).encode("utf-8"), name or "table.csv"
    if isinstance(obj, (bytes, bytearray)):
        if not name:
            raise ValueError("Give a name when attaching bytes, e.g. name='reading.txt'")
        return bytes(obj), name
    if isinstance(obj, (str, os.PathLike)):
        file = Path(obj).expanduser()
        if not file.is_file():
            raise NotFoundError(f"There's no file at {file}")
        return file.read_bytes(), name or file.name
    raise TypeError(f"Can't attach a {type(obj).__name__}: use a figure, a DataFrame, a file path or bytes")


def _figure_format(name: Optional[str]) -> str:
    ext = md.extension(name or "")
    return ext if ext in ("png", "svg", "pdf", "jpg", "jpeg") else "png"


def _number(cell: str) -> Any:
    try:
        return int(cell)
    except ValueError:
        pass
    try:
        return float(cell)
    except ValueError:
        return cell


def _frame(table: md.Table) -> Any:
    columns = list(table.header)
    # A column becomes numbers only if every filled cell in it is one.
    numeric = [
        all(isinstance(_number(r[i]), (int, float)) for r in table.rows if r[i] != "") for i in range(len(columns))
    ]
    rows = [[(_number(c) if numeric[i] and c != "" else (None if c == "" else c)) for i, c in enumerate(r)]
            for r in table.rows]
    try:
        import pandas
    except ImportError:
        return [dict(zip(columns, r)) for r in rows]
    return pandas.DataFrame(rows, columns=columns)


# Shortcuts for the vault ``connect()`` finds on its own, e.g. in an analysis cell.


def attach(obj: Any, entry: str, name: Optional[str] = None, under: Optional[str] = None) -> str:
    return connect().entry(entry).attach(obj, name=name, under=under)


def record(entry: str, measurement: str, value: Any, unit: str = "", note: str = "") -> None:
    connect().entry(entry).record(measurement, value, unit=unit, note=note)


def tables(entry: str) -> Dict[str, Any]:
    return connect().entry(entry).tables()
