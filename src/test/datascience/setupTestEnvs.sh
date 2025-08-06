uv venv .venvnoreg
uv venv .venvnokernel
uv venv .venvkernel

source .venvkernel/bin/activate
python --version
python -c "import sys;print(sys.executable)"
uv pip install ipykernel
python -m ipykernel install --user --name .venvkernel --display-name .venvkernel
uv pip uninstall jedi --yes
uv pip install jedi==0.17.2
uv pip install ipywidgets==7.7.2

source .venvnokernel/bin/activate
python --version
python -c "import sys;print(sys.executable)"
uv pip install ipykernel
python -m ipykernel install --user --name .venvnokernel --display-name .venvnokernel
uv pip uninstall jedi --yes
uv pip install jedi==0.17.2
uv pip uninstall ipykernel --yes
