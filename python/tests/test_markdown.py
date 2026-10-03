import pytest

from prem import _markdown as md


def test_frontmatter():
    fm = md.parse_frontmatter('---\ntype: run\nprotocol: "[[Miniprep]]"\n---\n\n# Run\n')
    assert fm.fields == {"type": "run", "protocol": "[[Miniprep]]"}
    assert md.parse_frontmatter("# No frontmatter\n") == ({}, 0)


def test_split_row_keeps_link_aliases_and_escaped_pipes():
    assert md.split_row("| [[Note|alias]] | a \\| b |  |") == ["[[Note|alias]]", "a | b", ""]


def test_tables_round_trip():
    rows = [["a | b", "[[Note|alias]]"], ["", "x"]]
    text = "Intro\n\n" + md.format_table(["One", "Two"], rows) + "\nAfter\n"
    (table,) = md.parse_tables(text)
    assert table.header == ["One", "Two"]
    assert table.rows == rows
    assert text[table.start : table.end] == md.format_table(["One", "Two"], rows)


def test_numbers_come_back_as_numbers():
    from prem import _frame

    table = md.parse_tables("| A | B |\n| - | - |\n| 1 | x |\n| 2.5 |  |\n")[0]
    frame = _frame(table)
    rows = frame.to_dict("records") if hasattr(frame, "to_dict") else frame
    assert rows[0]["A"] == 1 and rows[1]["A"] == 2.5 and rows[0]["B"] == "x"


def test_headed_tables():
    text = "---\ntype: run\n---\n# Run\n\n| A |\n| - |\n| 1 |\n\n## Results\n| B |\n| --- |\n| 2 |\n"
    assert [(h, t.rows) for h, t in md.headed_tables(text)] == [("Run", [["1"]]), ("Results", [["2"]])]


def test_record_creates_the_results_section():
    text = md.record_result("# Gel\n\nText.\n", "Colonies", 84)
    assert text == "# Gel\n\nText.\n\n## Results\n| Measurement | Value |\n| --- | --- |\n| Colonies | 84 |\n"


def test_record_updates_a_row_and_keeps_the_rest():
    text = "# R\n\n## Results\n| Measurement | Value |\n| --- | ---: |\n| OD600 | 0.3 |\n\nRegistered.\n\n## Next\n"
    text = md.record_result(text, "od600", 0.41)
    text = md.record_result(text, "Yield", 112, unit="ng/µL")
    assert "| od600 | 0.41 |   |" in text
    assert "| Yield | 112 | ng/µL |" in text
    assert text.endswith("\nRegistered.\n\n## Next\n")
    assert "| --- | ---: | --- |" in text
    text = md.record_result(text, "Yield", 120, replace=False)
    assert text.count("| Yield |") == 2


def test_record_under_a_results_heading_without_a_table():
    text = md.record_result("# R\n\n## Results\nSee below.\n\n## Notes\nx\n", "pH", 7.4)
    assert "## Results\nSee below.\n\n| Measurement | Value |" in text
    assert text.endswith("| pH | 7.4 |\n\n## Notes\nx\n")


def test_append_block():
    assert md.append_block("# A\n", "![p](attachments/p.png)") == "# A\n\n![p](attachments/p.png)\n"
    text = md.append_block("# A\n\n## Results\nx\n\n## Notes\n", "![p](p.png)", under="Results")
    assert text == "# A\n\n## Results\nx\n\n![p](p.png)\n\n## Notes\n"
    assert md.append_block("# A", "y", under="Figures") == "# A\n\n## Figures\ny\n"


def test_attachment_names_and_links():
    assert md.attachment_file_name("gel ?.png") == "gel.png"
    assert md.numbered_name("gel.png", 2) == "gel 2.png"
    assert md.attachment_folder("Notebook/2026/Gel.md") == "Notebook/2026/attachments"
    assert md.attachment_markdown("N/Gel.md", "N/attachments/gel run (1).png") == (
        "![gel run (1).png](attachments/gel%20run%20%281%29.png)"
    )
    assert md.attachment_markdown("Gel.md", "attachments/plate.xlsx") == "[plate.xlsx](attachments/plate.xlsx)"
    with pytest.raises(ValueError):
        md.attachment_file_name("note.md")


@pytest.mark.parametrize("bad", ["/etc/passwd", "../x.md", "a/../../x", "C:\\x", ".prem/history/x.jsonl"])
def test_paths_stay_in_the_vault(bad):
    with pytest.raises(md.InvalidPath):
        md.normalize_path(bad)


def test_numpy_and_pandas_numbers_read_like_plain_ones():
    numpy = pytest.importorskip("numpy")
    assert md.format_value(numpy.float64(112.4)) == "112.4"
    assert md.format_value(numpy.int64(84)) == "84"
    assert md.format_value(numpy.float32(0.5)) == "0.5"
    assert md.format_value(numpy.bool_(True)) == "yes"
    assert md.format_value(1.86) == "1.86"
    pandas = pytest.importorskip("pandas")
    mean = pandas.Series([112.1, 112.9, 112.2]).mean().round(1)
    text = md.record_result("# R\n", "Concentration", mean, unit="ng/µL")
    assert "| Concentration | 112.4 | ng/µL |" in text
