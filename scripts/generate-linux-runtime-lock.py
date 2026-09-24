import json
import hashlib
import urllib.request

NODE_VERSION = "24.21.0"
PYTHON_VERSION = "3.12.14"
PYTHON_RELEASE = "20260901"

packages = {
    "numpy": "2.3.5",
    "pandas": "3.0.1",
    "pillow": "12.3.0",
    "lxml": "6.1.3",
}


def get_json(url):
    with urllib.request.urlopen(url) as r:
        return json.load(r)


def get_text(url):
    with urllib.request.urlopen(url) as r:
        return r.read().decode()


# ---------------------------------------------------------
# Node
# ---------------------------------------------------------

node_filename = f"node-v{NODE_VERSION}-linux-x64.tar.gz"

shasums = get_text(
    f"https://nodejs.org/dist/v{NODE_VERSION}/SHASUMS256.txt"
)

node_sha = None

for line in shasums.splitlines():
    sha, filename = line.split(maxsplit=1)

    if filename == node_filename:
        node_sha = sha
        break

if not node_sha:
    raise RuntimeError("Node Linux x64 SHA not found")


# O lock guarda só a parte depois de node-vVERSION-
node_archive = "linux-x64.tar.gz"


# ---------------------------------------------------------
# Python standalone
# ---------------------------------------------------------

python_asset = (
    f"cpython-{PYTHON_VERSION}+{PYTHON_RELEASE}-"
    "x86_64-unknown-linux-gnu-install_only_stripped.tar.gz"
)

release = get_json(
    "https://api.github.com/repos/"
    "astral-sh/python-build-standalone/"
    f"releases/tags/{PYTHON_RELEASE}"
)

python_sha = None

for asset in release["assets"]:
    if asset["name"] != python_asset:
        continue

    digest = asset.get("digest")

    if digest and digest.startswith("sha256:"):
        python_sha = digest.removeprefix("sha256:")
        break

if not python_sha:
    raise RuntimeError(
        f"SHA256 not available for {python_asset}"
    )


# ---------------------------------------------------------
# PyPI native wheels
# ---------------------------------------------------------

wheels = []

for package, version in packages.items():
    data = get_json(
        f"https://pypi.org/pypi/{package}/{version}/json"
    )

    candidates = []

    for file in data["urls"]:
        filename = file["filename"]

        if not filename.endswith(".whl"):
            continue

        # Python 3.12 CPython
        if "cp312" not in filename:
            continue

        # Linux x86_64
        if "x86_64" not in filename:
            continue

        # Queremos glibc/manylinux, não musl.
        if "manylinux" not in filename:
            continue

        if "musllinux" in filename:
            continue

        candidates.append(file)

    if not candidates:
        raise RuntimeError(
            f"No Linux x64 wheel for {package} {version}"
        )

    # Dá preferência ao wheel manylinux mais genérico.
    candidates.sort(
        key=lambda f: (
            "manylinux_2_17" not in f["filename"],
            "manylinux2014" not in f["filename"],
            f["filename"],
        )
    )

    file = candidates[0]

    wheels.append({
        "url": file["url"],
        "sha256": file["digests"]["sha256"],
    })

    print(
        f"{package}:",
        file["filename"],
    )


entry = {
    "nodeArchive": node_archive,
    "nodeSha256": node_sha,
    "pythonTarget": "x86_64-unknown-linux-gnu",
    "pythonSha256": python_sha,
    "wheels": wheels,
}

print()
print(json.dumps({
    "linux-x64": entry
}, indent=2))