"""Reading and writing the parts of a note Prem gives meaning to: frontmatter, ``## Heading`` sections,
markdown tables and attachment links. These follow the app's own rules (``src/shared``), so a note
edited here reads the same in Prem."""

from __future__ import annotations

import posixpath
import re
from typing import Dict, List, NamedTuple, Optional, Tuple
from urllib.parse import quote

ATTACHMENTS_FOLDER = "attachments"
MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024

_IMAGE = {"png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"}
_TABLE = {"csv", "tsv"}
_NOTEBOOK = {"ipynb"}


# ---------------------------------------------------------------- paths


class InvalidPath(ValueError):
    pass


def normalize_path(path: str) -> str:
    """A vault-relative POSIX path, as the app writes them. Absolute paths and ``..`` are refused."""
    if "\0" in path:
        raise InvalidPath("Path contains a NUL byte")
    if re.match(r"^([a-zA-Z]:|[\\/])", path):
        raise InvalidPath(f"Path must be relative to the vault: {path}")
    parts = [p for p in path.replace("\\", "/").split("/") if p not in ("", ".")]
    if ".." in parts:
        raise InvalidPath(f'Path may not contain "..": {path}')
    if parts and parts[0].startswith("."):
        raise InvalidPath(f"Prem's hidden folders can't be changed from here: {path}")
    return "/".join(parts)


def dirname(path: str) -> str:
    return posixpath.dirname(path)


def note_title(path: str) -> str:
    name = posixpath.basename(path)
    return name[:-3] if name.lower().endswith(".md") else name


def sanitize_file_name(name: str) -> str:
    """A name that's safe on macOS, Windows and Linux (the app's ``sanitizeFileName``)."""
    cleaned = re.sub(r'[\\/:*?"<>|#^\[\]]', " ", name)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = re.sub(r"^\.+", "", cleaned)
    return cleaned or "Untitled"


def attachment_file_name(name: str) -> str:
    cleaned = re.sub(r"\s+(\.[^.\s]+)$", r"\1", sanitize_file_name(name))
    if cleaned.lower().endswith(".md"):
        raise ValueError("Markdown files are notes, not attachments")
    return cleaned


def numbered_name(name: str, n: int) -> str:
    """``gel.png`` → ``gel 1.png``, keeping the extension."""
    if n == 0:
        return name
    dot = name.rfind(".")
    return f"{name[:dot]} {n}{name[dot:]}" if dot > 0 else f"{name} {n}"


def extension(path: str) -> str:
    name = posixpath.basename(path)
    dot = name.rfind(".")
    return name[dot + 1 :].lower() if dot > 0 else ""


def attachment_folder(note_path: str) -> str:
    folder = dirname(note_path)
    return f"{folder}/{ATTACHMENTS_FOLDER}" if folder else ATTACHMENTS_FOLDER


def attachment_markdown(note_path: str, attachment_path: str) -> str:
    """Embedded (``![…]``) if Prem previews the type, a plain link otherwise; relative to the note."""
    base = dirname(note_path)
    rel = attachment_path[len(base) + 1 :] if base and attachment_path.startswith(base + "/") else attachment_path
    url = quote(rel, safe="/!$&'*+,;=:@-._~").replace("(", "%28").replace(")", "%29")
    name = re.sub(r"[\[\]]", "", posixpath.basename(rel))
    ext = extension(rel)
    embedded = ext in _IMAGE or ext in _TABLE or ext in _NOTEBOOK
    return f"![{name}]({url})" if embedded else f"[{name}]({url})"


# ---------------------------------------------------------------- frontmatter


class Frontmatter(NamedTuple):
    fields: Dict[str, str]
    end: int  # offset just past the closing ``---`` line, or 0 when there's none


def parse_frontmatter(text: str) -> Frontmatter:
    """The flat ``key: value`` block at the top of a note."""
    if not re.match(r"^---\r?\n", text):
        return Frontmatter({}, 0)
    body_start = text.index("\n") + 1
    close = re.search(r"^(---|\.\.\.)[ \t]*$", text[body_start:], re.M)
    if not close:
        return Frontmatter({}, 0)
    fields: Dict[str, str] = {}
    for line in text[body_start : body_start + close.start()].splitlines():
        m = re.match(r"^([A-Za-z0-9_-]+):[ \t]*(.*?)[ \t]*$", line)
        if m:
            value = m.group(2)
            q = re.match(r'^"(.*)"$', value) or re.match(r"^'(.*)'$", value)
            fields[m.group(1)] = q.group(1) if q else value
    line_end = text.find("\n", body_start + close.start())
    return Frontmatter(fields, len(text) if line_end < 0 else line_end + 1)


# ---------------------------------------------------------------- sections and tables


def find_section(text: str, heading: str) -> Optional[Tuple[int, int]]:
    """Where a ``## Heading`` section's content is: just after the heading line, to the next ``## `` or the end."""
    m = re.search(rf"^## {re.escape(heading)}[ \t]*$", text, re.M | re.I)
    if not m:
        return None
    start = min(len(text), m.end() + 1)
    nxt = re.search(r"^## ", text[start:], re.M)
    return start, start + nxt.start() if nxt else len(text)


_ROW = re.compile(r"^\s*\|.*\|\s*$")
_SEPARATOR = re.compile(r"^\s*\|(\s*:?-+:?\s*\|)+\s*$")


def split_row(line: str) -> List[str]:
    """The cells of a ``| a | b |`` row. Pipes inside ``[[link|alias]]`` or escaped as ``\\|`` don't split."""
    inner = re.sub(r"\|$", "", re.sub(r"^\|", "", line.strip()))
    cells: List[str] = []
    cell = ""
    depth = 0
    i = 0
    while i < len(inner):
        c, nxt = inner[i], inner[i + 1 : i + 2]
        if c == "\\" and nxt == "|":
            cell += "|"
            i += 1
        elif c == "[" and nxt == "[":
            depth += 1
            cell += "[["
            i += 1
        elif c == "]" and nxt == "]" and depth > 0:
            depth -= 1
            cell += "]]"
            i += 1
        elif c == "|" and depth == 0:
            cells.append(cell.strip())
            cell = ""
        else:
            cell += c
        i += 1
    cells.append(cell.strip())
    return cells


class Table(NamedTuple):
    header: List[str]
    rows: List[List[str]]
    start: int  # offsets of the table's lines in the text, ``end`` just past the last line's newline
    end: int
    aligns: List[str]  # each column's separator: ``---``, ``:---``, ``---:`` or ``:---:``


def parse_tables(text: str, start: int = 0, end: Optional[int] = None) -> List[Table]:
    """Every table between ``start`` and ``end``, with rows padded or cut to the header's width."""
    stop = len(text) if end is None else end
    lines = text[start:stop].split("\n")
    tables: List[Table] = []
    pos = start
    i = 0
    while i < len(lines) - 1:
        if _ROW.match(lines[i]) and _SEPARATOR.match(lines[i + 1]):
            header = split_row(lines[i])
            seps = [_align(c) for c in split_row(lines[i + 1])]
            aligns = [seps[k] if k < len(seps) else "---" for k in range(len(header))]
            table_start = pos
            pos += len(lines[i]) + 1 + len(lines[i + 1]) + 1
            rows: List[List[str]] = []
            j = i + 2
            while j < len(lines) and _ROW.match(lines[j]):
                cells = split_row(lines[j])
                rows.append([cells[k] if k < len(cells) else "" for k in range(len(header))])
                pos += len(lines[j]) + 1
                j += 1
            tables.append(Table(header, rows, table_start, min(pos, stop), aligns))
            i = j
            continue
        pos += len(lines[i]) + 1
        i += 1
    return tables


def _align(separator: str) -> str:
    left, right = separator.startswith(":"), separator.endswith(":")
    return (":" if left else "") + "---" + (":" if right else "")


def escape_cell(value: str) -> str:
    """Pipes outside links are escaped and line breaks become spaces."""
    parts = re.split(r"(\[\[[^\]]*\]\])", re.sub(r"\r?\n", " ", value))
    return "".join(p if i % 2 else re.sub(r"(?<!\\)\|", r"\\|", p) for i, p in enumerate(parts)).strip()


def format_table(header: List[str], rows: List[List[str]], aligns: Optional[List[str]] = None) -> str:
    def line(cells: List[str]) -> str:
        return "| " + " | ".join(escape_cell(c) or " " for c in cells) + " |"

    seps = [(aligns[i] if aligns and i < len(aligns) else "---") for i in range(len(header))]
    return "\n".join([line(header), "| " + " | ".join(seps) + " |", *map(line, rows)]) + "\n"


def headed_tables(text: str) -> List[Tuple[str, Table]]:
    """Each table in the note with the heading it's under (any level), or the note's title for none."""
    body_start = parse_frontmatter(text).end
    headings = [(m.start(), m.group(1).strip()) for m in re.finditer(r"^#{1,6} +(.+?)[ \t#]*$", text, re.M)]
    found = []
    for table in parse_tables(text, body_start):
        above = [h for pos, h in headings if pos < table.start]
        found.append((above[-1] if above else "", table))
    return found


# ---------------------------------------------------------------- edits


def append_block(text: str, block: str, under: Optional[str] = None) -> str:
    """Adds a paragraph at the end of the note, or at the end of the ``## under`` section (created if missing)."""
    if under:
        section = find_section(text, under)
        if section:
            start, end = section
            body = text[start:end].rstrip()
            rest = text[end:]
            return text[:start] + body + ("\n\n" if body else "") + block + "\n" + ("\n" + rest if rest else "")
        return _with_trailing_newline(text) + f"\n## {under}\n{block}\n"
    return _with_trailing_newline(text) + f"\n{block}\n"


def _with_trailing_newline(text: str) -> str:
    return text if not text or text.endswith("\n") else text + "\n"


RESULTS_HEADING = "Results"


def format_value(value: object) -> str:
    """A value as it reads in a table. NumPy and pandas numbers are written like plain Python ones
    (``112.4``, not ``np.float64(112.4)``)."""
    # NumPy scalars have .item(), which gives the plain Python value; 0-d arrays too.
    if type(value).__module__ == "numpy" and hasattr(value, "item"):
        value = value.item()  # type: ignore[union-attr]
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, float):
        return repr(float(value))
    return str(value)


def record_result(
    text: str,
    measurement: str,
    value: object,
    unit: str = "",
    note: str = "",
    replace: bool = True,
    heading: str = RESULTS_HEADING,
) -> str:
    """Adds a row to the Results table (or updates the one with the same measurement), creating it if needed.

    An existing table keeps its own columns; Unit and Note columns are added only when they're given."""
    values = {"measurement": measurement, "value": format_value(value), "unit": unit, "note": note}
    section = find_section(text, heading)
    tables = parse_tables(text, *section) if section else []
    if not tables:
        header = ["Measurement", "Value"] + [h for h in ("Unit", "Note") if values[h.lower()]]
        table = format_table(header, [[values[h.lower()] for h in header]])
        if section:
            start, end = section
            body = text[start:end].rstrip()
            rest = text[end:]
            return text[:start] + body + ("\n\n" if body else "") + table + ("\n" + rest if rest else "")
        return _with_trailing_newline(text) + f"\n## {heading}\n{table}"

    table = tables[0]
    header = list(table.header)
    aligns = list(table.aligns)
    rows = [list(r) for r in table.rows]
    lower = [h.lower() for h in header]
    for extra in ("unit", "note"):
        if values[extra] and extra not in lower:
            header.append(extra.capitalize())
            aligns.append("---")
            lower.append(extra)
            for r in rows:
                r.append("")

    def column(name: str, fallback: int) -> int:
        return lower.index(name) if name in lower else fallback

    m_col = column("measurement", 0)
    v_col = column("value", 1 if len(header) > 1 else 0)
    existing = next(
        (r for r in rows if replace and r[m_col].strip().lower() == measurement.strip().lower()),
        None,
    )
    row = existing if existing is not None else [""] * len(header)
    row[m_col] = measurement
    row[v_col] = values["value"]
    for extra in ("unit", "note"):
        if values[extra]:
            row[lower.index(extra)] = values[extra]
    if existing is None:
        rows.append(row)
    return text[: table.start] + format_table(header, rows, aligns) + text[table.end :]
