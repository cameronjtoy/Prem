import shutil
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SAMPLE_VAULT = REPO / "examples" / "sample-vault"


@pytest.fixture
def vault_dir(tmp_path: Path) -> Path:
    """A fresh copy of the example vault, with the hidden folder Prem keeps history in."""
    root = tmp_path / "vault"
    shutil.copytree(SAMPLE_VAULT, root)
    (root / ".prem" / "history").mkdir(parents=True)
    return root
