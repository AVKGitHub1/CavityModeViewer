# Interactive Cavity Mode Viewer

## Browser App

It can be accessed here:

[https://avkgithub1.github.io/CavityModeViewer](https://avkgithub1.github.io/CavityModeViewer)

The repository includes a static browser version of the cavity viewer:

- `index.html`
- `mode-scan.html`
- `styles.css`
- `cavity-core.js`
- `app.js`
- `mode-scan.js`
- `.nojekyll`

### Browser Features

The browser app has two linked views:

1. `index.html`
   Main cavity viewer for:
   - cavity geometry
   - wavelength and refractive index
   - cavity mode profile
   - `g1-g2` stability diagram

2. `mode-scan.html`
   Mode-matching and scan view for:
   - camera intensity
   - cavity transmission scan
   - input beam waist and ROC
   - `x` and `y` offsets from `0` to `1 mm` with `1 um` step
   - scan range in `FSR`
   - `Max HG order` to set maximum order of the simulated Hermite-Gauss mode

The `Open mode scan` button on the main viewer passes the current cavity parameters to the scan page.
The `Back to viewer` link preserves those same cavity parameters when returning to the main page.

### Use Locally

Open `index.html` in a browser for a quick check, or serve the folder locally:

```powershell
python -m http.server 8000
```

Then visit `http://localhost:8000/`.

Recommended flow:

1. Open `index.html`
2. Set `R1`, `R2`, `L`, wavelength, and `n_center`
3. Click `Open mode scan`
4. Adjust the beam and scan controls

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

## Python Version

Python scripts are also included:

- `cavity-mode-display.py`
- `cavity-gui.py`

### Requirements

- numpy
- matplotlib
- PyQt6
