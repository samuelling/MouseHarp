# MouseHarp

A synthesizer played by a cubic millimetre of mouse visual cortex. Sister project to [FlyHarp](https://github.com/samuelling/FlyHarp).

Point your webcam at something, or pick a grating, and the image drives **50,948 neurons from the MICrONS volume**, wired by their measured synapses. Each cell class is an instrument, and every 30° of preferred orientation is a string. Turn a pen in front of the camera and you play a scale.

**Run it locally:** `python -m http.server` in this folder, then open http://localhost:8000. Everything runs in the browser; the network steps in a Web Worker.

## What's in it

- **What the cortex sees.** Every imaged neuron is drawn as a tick at its receptive-field centre and preferred orientation, lit by its response. Other lenses show L2/3, L4, L5, L6 and the interneurons.
- **Strings.** Eight cell classes (L2/3, L4, L5, L6 pyramidal; perisomatic-, dendrite-, sparsely- and inhibitory-targeting interneurons) × four areas (V1, RL, AL, LM) × seven orientation bins.
  - Pitch comes from orientation; octave and instrument come from cell class; stereo position comes from area.
  - Broadly tuned cells play the root.
  - MIDI out uses one channel per class.
- **Activity traces** for each class, V1 vs higher areas.
- **Inside the cubic millimetre.** A 3D ball-and-stick view of every neuron at its EM soma position, with the two strongest inputs per cell as sticks, all lit live.

## The model

- **Wiring.** The MICrONS v1412 connectome as exported by Reimann (Zenodo [16744240](https://doi.org/10.5281/zenodo.16744240), CC-BY 4.0): 50,948 neurons and 11.55M synapses in 7.46M connections, internal to the volume.
  - MouseHarp keeps the 1.89M connections made of ≥ 2 synapses (6.0M synapses).
  - Each neuron's kept excitatory and inhibitory input is rescaled to its full total.
  - Sign comes from the presynaptic cell class; weight comes from synapse count.
- **Dynamics.** A rate model: τ dr/dt = −r + f(Σ w r + input + h − b·a).
  - f is a rectified, saturating square law; a is spike-rate adaptation (300 ms).
  - τ is 20 ms for pyramidal cells and 10 ms for interneurons; the step is 6.7 ms.
  - The four E/I gain parameters were set by hand for stable dynamics that return to rest.
- **Input.** Only the 11,483 neurons that were imaged in vivo and matched to the EM volume receive the image.
  - Their drive is oriented contrast energy at their receptive-field centre and preferred orientation, mixed with untuned energy by their selectivity.
  - Tuning and receptive-field centres come from the MICrONS digital twin (Ding et al. 2025 node table; Wang et al. 2025).
  - Everything else is reached only through synapses.
- **Tuning of the other cells** is mapped in silico, with drifting gratings at 12 orientations and counter-phase patches on a grid. For the imaged cells this recovers their measured preference (median error 1.6°) and receptive-field centre (0.7 px of 32).

**Caveats.**
- The gains are not fit to data, unlike the trained fly model behind FlyHarp.
- Most axons in the volume are not proofread, so connectivity is incomplete.
- The volume contains no thalamic cell bodies, so the measured tuning stands in for the real feedforward input.
- The receptive-field cloud of the imaged cells (a patch of the visual field) is stretched to fill the camera frame.

This is the MICrONS wiring played through a simple model, not a simulation of mouse V1.

## Rebuilding the data

```
tools/fetch_data.sh                  # ~1.1 GB from Zenodo and the MICrONS BossDB bucket
cd tools
python build_model.py                # join connectome + function, prune, rescale  -> build/model.npz
python map_model.py                  # in-silico orientation and RF mapping          -> build/model_tuning.npz
python export_web.py                 # browser files                                 -> ../data/
node validate_engine.js ../data build/ref.json   # JS engine vs Python reference
```

The node table is a pandas pickle. `safe_pickle.py` loads it with a whitelisting unpickler (only the pandas/NumPy data classes it references), so no other code can run.

## Data and credits

- MICrONS Consortium et al., *Functional connectomics spanning multiple areas of mouse visual cortex*, Nature 2025.
- Ding, Fahey, Papadopoulos et al., *Functional connectomics reveals general wiring rule in mouse visual cortex*, Nature 2025.
- Wang et al., *Foundation model of neural activity predicts response to new stimulus types*, Nature 2025.
- Schneider-Mizell et al., *Inhibitory specificity from a connectomic census of mouse visual cortex*, Nature 2025 (inhibitory classes).
- Reimann, M. W., *Connectomics of (part of) the MICrONS mm3 dataset*, Zenodo 2025.
- See [microns-explorer.org](https://www.microns-explorer.org) for MICrONS data terms. three.js (MIT) is vendored in `js/vendor`.
