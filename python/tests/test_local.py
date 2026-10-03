import json
import os

import pytest

import prem

RUN = "Notebook/Runs/2026/Plasmid miniprep run 2026-09-29 1410.md"
EXPERIMENT = "Notebook/2026/Ligation of insert into pUC19.md"


def test_connect_finds_the_vault_from_a_folder_inside_it(vault_dir, monkeypatch):
    monkeypatch.delenv("PREM_VAULT", raising=False)
    monkeypatch.chdir(vault_dir / "Notebook" / "2026")
    vault = prem.connect()
    assert vault.location == str(vault_dir.resolve())
    monkeypatch.chdir(vault_dir.parent)
    with pytest.raises(prem.NotFoundError, match="isn't inside a Prem vault"):
        prem.connect()
    monkeypatch.setenv("PREM_VAULT", str(vault_dir))
    assert prem.connect().name == "vault"


def test_entries_by_path_or_title(vault_dir):
    vault = prem.connect(vault_dir)
    assert vault.entry("Samples/S-0001").path == "Samples/S-0001.md"
    assert vault.entry("[[Plasmid miniprep]]").path == "Protocols/Plasmid miniprep.md"
    assert vault.entry("s-0002").fields["type"] == "sample"
    with pytest.raises(prem.NotFoundError):
        vault.entry("Nothing like this")
    assert [e.path for e in vault.notes(type="run")] == [RUN]


def test_record_and_read_back(vault_dir):
    entry = prem.connect(vault_dir).entry(RUN)
    entry.record("Concentration", 118)
    entry.record("Purity check", "passed", note="by eye")
    text = (vault_dir / RUN).read_text()
    assert "| Concentration | 118 |   |" in text
    # The run's table had no Note column; one is added for the row that has a note.
    assert "| Measurement | Value | Note |" in text
    assert "| Purity check | passed | by eye |" in text
    results = entry.table("Results")
    rows = results.to_dict("records") if hasattr(results, "to_dict") else results
    # The column also holds "48 µL" and "passed", so values stay text.
    assert rows[0]["Measurement"] == "Concentration" and rows[0]["Value"] == "118"
    assert "| --- | ---: | --- |" in text  # the table's own alignment is kept


def test_attach_a_figure_a_dataframe_and_a_file(vault_dir, tmp_path):
    pandas = pytest.importorskip("pandas")
    matplotlib = pytest.importorskip("matplotlib")
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    entry = prem.connect(vault_dir).entry(EXPERIMENT)
    fig, ax = plt.subplots()
    ax.plot([1, 2, 3])
    assert entry.attach(fig, name="growth.png") == "Notebook/2026/attachments/growth.png"
    assert entry.attach(fig, name="growth.png") == "Notebook/2026/attachments/growth 1.png"
    df = pandas.DataFrame({"well": ["A1", "A2"], "od": [0.41, 0.39]})
    assert entry.attach(df, name="plate.csv", under="Results") == "Notebook/2026/attachments/plate.csv"
    raw = tmp_path / "reading.xlsx"
    raw.write_bytes(b"PK")
    entry.attach(raw)

    folder = vault_dir / "Notebook" / "2026" / "attachments"
    assert (folder / "growth.png").read_bytes().startswith(b"\x89PNG")
    assert (folder / "plate.csv").read_text() == "well,od\nA1,0.41\nA2,0.39\n"
    text = entry.text
    assert "![growth.png](attachments/growth.png)\n" in text
    assert "![growth 1.png](attachments/growth%201.png)" in text
    assert "[reading.xlsx](attachments/reading.xlsx)" in text
    results = text[text.index("## Results") :]
    assert "![plate.csv](attachments/plate.csv)" in results.split("\n## ")[0]
    assert entry.read_file("attachments/plate.csv").startswith(b"well,od")


def test_signed_notes_are_never_changed(vault_dir):
    log = vault_dir / ".prem" / "history" / (EXPERIMENT + ".jsonl")
    log.parent.mkdir(parents=True)
    entries = [{"n": 1, "kind": "save"}, {"n": 2, "kind": "signed"}, {"n": 3, "kind": "witnessed"}]
    log.write_text("".join(json.dumps(e) + "\n" for e in entries))
    entry = prem.connect(vault_dir).entry(EXPERIMENT)
    before = (vault_dir / EXPERIMENT).read_bytes()
    assert entry.locked
    with pytest.raises(prem.LockedError, match="Amend"):
        entry.record("Colonies", 84)
    with pytest.raises(prem.LockedError):
        entry.attach(b"x", name="x.txt")
    assert (vault_dir / EXPERIMENT).read_bytes() == before
    assert not (vault_dir / "Notebook" / "2026" / "attachments" / "x.txt").exists()

    # An amendment unlocks it until it's signed again.
    with log.open("a") as f:
        f.write(json.dumps({"n": 4, "kind": "amended"}) + "\n")
    entry.record("Colonies", 84)


def test_a_note_changed_mid_write_is_not_overwritten(vault_dir, monkeypatch):
    entry = prem.connect(vault_dir).entry("Samples/S-0001")
    backend = entry.vault._backend
    real_read = backend.read

    def read_then_someone_edits(path):
        result = real_read(path)
        (vault_dir / path).write_text(result[0] + "\nEdited in Prem.\n")
        return result

    monkeypatch.setattr(backend, "read", read_then_someone_edits)
    with pytest.raises(prem.ConflictError):
        entry.record("Volume", 48)
    assert (vault_dir / "Samples/S-0001.md").read_text().endswith("Edited in Prem.\n")


def test_nothing_is_written_outside_the_vault(vault_dir):
    vault = prem.connect(vault_dir)
    with pytest.raises(Exception):
        vault.entry("../outside")
    assert not os.path.exists(vault_dir.parent / "outside.md")
