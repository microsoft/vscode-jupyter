dotnet tool install -g --add-source "https://pkgs.dev.azure.com/dnceng/public/_packaging/dotnet-tools/nuget/v3/index.json" Microsoft.dotnet-interactive
export PATH="/$HOME/.dotnet/tools:${PATH}"
mkdir -p $HOME/.local/share/jupyter/kernels
dotnet interactive jupyter install

wget https://julialang-s3.julialang.org/bin/linux/x64/1.7/julia-1.7.0-linux-x86_64.tar.gz
tar -xvzf julia-1.7.0-linux-x86_64.tar.gz
sudo cp -r julia-1.7.0 /opt/
sudo ln -s /opt/julia-1.7.0/bin/julia /usr/local/bin/julia
rm julia-1.7.0-linux-x86_64.tar.gz
rm -r julia-1.7.0
julia -e '
  using Pkg
  Pkg.add("IJulia")'