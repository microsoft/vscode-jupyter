
The sequence of events for the following events when renaming a notebook isn't obvious to the model.
I had to document these (i have another branch where I documented these events in another md file).
- onWillRenameFile
- onDidRenameFile
- onDidCloseNotebook
- onDidOpenNotebook

Similarly when using these architecture documents (lets call them reference documents), the model was able to generate some some very good code.
In one case did this the first time around.
I say one case, because everytime I had to tweak the prompts and the docs to include the right information and start again.
I tried 4 features
* Ensuring the kernel is persisted when we rename a notebook
* Ensure the code to interrupt a kernel is implemented in rust as opposed to Python (this worked 1st time after documenting the interrupt flow, without that the model would never genrate the right code)
* Avoid restarting kernel when we install a package into a notebook without ever running any cells
With docs, works very easily. Reads just 4 files.
Without docs, reads 33 files, read vscode API, searches code base for a number of different text,
Eventually hit max tool calls and had to hit continue.
& the result worked the solution was the same, but slower.
