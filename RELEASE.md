# Release Steps

## @jk2908/cxx

1. Update `packages/cxx/package.json` version
2. Update `packages/cxx/CHANGELOG.md` with new entry
3. Update `packages/cxx/README.md` if features need documenting
4. Commit changes
5. Tag the release: `git tag @jk2908/cxx@X.X.X`
6. Push to remote: `git push origin main && git push origin @jk2908/cxx@X.X.X`
7. Build the package: `cd packages/cxx && bun run build`
8. Publish to npm: `npm publish`

## vscode-cxx

1. Update `packages/vscode-cxx/package.json` version
2. Update `packages/vscode-cxx/CHANGELOG.md` with new entry
3. Commit changes
4. Tag the release: `git tag vscode-cxx@X.X.X`
5. Push to remote: `git push origin main && git push origin vscode-cxx@X.X.X`
6. CI packages the VSIX and attaches it to a GitHub Release automatically