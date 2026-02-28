# Interactive Cavity Mode Viewer

## Python Version
Execute `cavity-mode-display.py`

### Requirements
- numpy
- matplotlib
- PyQt6


## Browser App
It can be accessed here:
```
https://avkgithub1.github.io/CavityModeViewer
``` 

The repository includes a static browser version of the cavity viewer:

- `index.html`
- `styles.css`
- `app.js`
- `.nojekyll`


### Use Locally
Open `index.html` in a browser for a quick check, or serve the folder locally:

```powershell
python -m http.server 8000
```

Then visit `http://localhost:8000/`.

### Publish to GitHub Pages

1. Commit and push the new web files to your GitHub repository.
2. On GitHub, open the repository and go to `Settings` > `Pages`.
3. In `Build and deployment`, set `Source` to `Deploy from a branch`.
4. Select your publishing branch, usually `main`, and choose the `/(root)` folder.
5. Save and wait for GitHub Pages to finish the deployment.

Because this repo now has a `.nojekyll` file, GitHub Pages can deploy the static files directly from the branch root without trying to run Jekyll.

For a project repository, the site URL is typically:

```text
https://<your-github-username>.github.io/<repository-name>/
```
