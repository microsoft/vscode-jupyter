FROM amd64/ubuntu

# Setup Python
RUN apt-get update && apt-get install -y python3 python3-pip
RUN python3 -m pip install ipykernel
# RUN apt install zsh -y
# RUN chsh -s $(which zsh)
# RUN sh -c "$(curl -fsSL https://github.com/deluan/zsh-in-docker/releases/download/v1.1.5/zsh-in-docker.sh)"
# RUN sh -c "$(wget -O- https://github.com/deluan/zsh-in-docker/releases/download/v1.1.1/zsh-in-docker.sh)" -- \
RUN apt install curl -y
RUN sh -c "$(curl -fsSL https://github.com/deluan/zsh-in-docker/releases/download/v1.1.5/zsh-in-docker.sh)" -- \
    -t powerlevel10k/powerlevel10k \
    -p git \
    -p git-extras \
    -p https://github.com/zsh-users/zsh-completions
RUN git clone https://github.com/romkatv/powerlevel10k $HOME/.oh-my-zsh/custom/themes/powerlevel10k
RUN curl https://raw.githubusercontent.com/DonJayamanne/vscode-jupyter/containerChanges/.devcontainer/.p10k.zsh > ~/.p10k.zsh
RUN echo "# To customize prompt, run `p10k configure` or edit ~/.p10k.zsh." >> ~/.zshrc
RUN echo "[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh" >> ~/.zshrc
