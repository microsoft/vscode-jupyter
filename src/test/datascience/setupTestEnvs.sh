python -m venv .venvnoreg
python -m venv .venvnokernel
python -m venv .venvkernel

source .venvkernel/bin/activate
python --version
python -c "import sys;print(sys.executable)"
python -m pip install ipykernel
python -m ipykernel install --user --name .venvkernel --display-name .venvkernel
python -m pip uninstall jedi --yes
python -m pip install jedi==0.17.2
python -m pip install ipywidgets==7.7.2

source .venvnokernel/bin/activate
python --version
python -c "import sys;print(sys.executable)"
python -m pip install ipykernel
python -m ipykernel install --user --name .venvnokernel --display-name .venvnokernel
python -m pip uninstall jedi --yes
python -m pip install jedi==0.17.2
python -m pip uninstall ipykernel --yes
