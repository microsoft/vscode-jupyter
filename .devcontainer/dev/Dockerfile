# See here for image contents: https://github.com/microsoft/vscode-dev-containers/tree/v0.169.0/containers/python-3-miniconda/.devcontainer/base.Dockerfile

FROM node:16.17.1-bullseye-slim

RUN apt-get -y update
RUN apt-get -y install apt-utils git gnupg2 curl locales ca-certificates sudo

# # [Option] Install zsh
ARG INSTALL_ZSH="true"
# # [Option] Upgrade OS packages to their latest versions
ARG UPGRADE_PACKAGES="false"

# # Copied from https://github.com/microsoft/vscode-dev-containers/blob/main/containers/python-3/.devcontainer/base.Dockerfile
# Install needed packages and setup non-root user. Use a separate RUN statement to add your own dependencies.
ARG USERNAME=vscode
ARG USER_UID=1000
ARG USER_GID=$USER_UID
RUN mkdir -p /tmp
RUN mkdir -p /tmp/library-scripts/
COPY .devcontainer/dev/*.sh .devcontainer/dev/*.env /tmp/library-scripts/
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive
# # Remove imagemagick due to https://security-tracker.debian.org/tracker/CVE-2019-10131
RUN apt-get purge -y imagemagick imagemagick-6-common
# Install common packages, non-root user
RUN bash /tmp/library-scripts/common-debian.sh "${INSTALL_ZSH}" "${USERNAME}" "${USER_UID}" "${USER_GID}" "${UPGRADE_PACKAGES}" "false" "false"
RUN apt-get autoremove -y && apt-get clean -y && rm -rf /var/lib/apt/lists/* /tmp/library-scripts

# # Finally install npm
RUN echo "npm i -g npm@8.15.1" | bash
