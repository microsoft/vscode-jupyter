for dir in src/client/datascience/*/
do
  dirSub=${dir:23:-1}
  echo "Running dependency analysis on $dirSub"
  npx dependency-cruise -X "^node_modules" -x "^(src/test|node_modules|src/datascience-ui)" --prefix "https://github.com/Microsoft/vscode-jupyter/blob/main/" -p -I "^src/client/datascience/$dirSub" -T dot src | dot -T svg | depcruise-wrap-stream-in-html > docs/$dirSub.html
done
