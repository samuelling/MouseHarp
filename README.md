# MouseHarp

A synthesizer played by a model of mouse primary visual cortex and its thalamic input. Sister project to [FlyHarp](https://github.com/samuelling/FlyHarp).

Point your webcam at something, or pick a grating, and the image runs through:
- the mouse **LGN** (ON and OFF thalamic cells with receptive fields fit to recordings);
- a **spiking model of V1** built from Allen Institute data and trained to match Neuropixels recordings.

Each cell family is an instrument:
- In V1, every 30° of preferred orientation is a string, so turning a pen in front of the camera plays a scale.
- In the LGN, each strip of visual field is a string.

**Run it:** `python -m http.server` here, then open http://localhost:8000. Everything runs in your browser; the network steps 1 ms at a time in a Web Worker, as fast as your machine allows.

The earlier version, driven by the **MICrONS connectome** and its digital-twin tuning, is at [`microns/`](microns/).

## The model

The engine is the **Allen Institute biorealistic V1 model** (point-neuron version of Billeh et al., *Neuron* 2020, rebuilt in [biorealistic-v1-model](https://github.com/AllenInstitute/biorealistic-v1-model)). MouseHarp uses network `core_nll_0` with its `bio_trained` weights, from the prebuilt networks of [V1_GLIF_model](https://github.com/JavierGalvan9/V1_GLIF_model).

- **Neurons:** 17 cell classes. Each neuron is a GLIF3 point neuron fit to Allen patch-clamp data.
- **Connections:** probabilities and strengths come from Allen synaptic physiology and MICrONS electron microscopy. The recurrent weights were then trained, with constraints on their distributions, to match Neuropixels recordings of mouse V1.
- **Synapses:** each is a sum of four alpha functions, with delays per connection type.
- **Background:** 100 Poisson sources at 250 Hz.
- **Input:** the model's FilterNet LGN. Each of 17,400 units has a Gaussian receptive field and a temporal filter fit to mouse dLGN recordings (Durand et al. 2016). The types are sustained ON, sustained and transient OFF, and ON/OFF cells with offset subfields. The units fire Poisson spikes into V1.
- **Not included:** a retinal stage (the LGN filters already contain the retina's transformation), feedback from V1 to LGN, and higher areas.

**What runs in the browser.** The full column is 400 µm across, with 66,658 neurons, 24.5M recurrent and 31.6M LGN synapses, too large to ship. MouseHarp runs its central 200 µm:
- 16,711 neurons and 12,383 LGN units, with every one of their LGN and background inputs kept.
- Each synapse they received from the outer ring is rewired from a **stand-in** inside the column: a neuron of the same cell type whose responses in the full model best match the missing cell's (grey screen plus gratings in 8 directions).
- Simpler stand-ins (class-average rates, with or without fluctuations) let layer 6 fall silent.

**Storage.** Weights are stored at 8 bits on a log scale. Targets are delta-coded. Synapse model and delay are recovered from cell types. The total download is about 36 MB.

## Validation

The steps and synapses follow the trained model's TensorFlow implementation (exact GLIF3 propagators, soft reset, 1 ms steps). Running the cloned research code directly was not possible in my build environment, so the checks are against data and against my own full-column reference.

**Full column (Python reimplementation), grey screen, against Neuropixels spontaneous rates** (mean Hz):

| class | model | recorded |
|---|---|---|
| L2/3 excitatory | 1.2 | 1.5 |
| L4 excitatory | 3.6 | 3.6 |
| L5 excitatory | 5.5 | 5.7 |
| L6 excitatory | 3.1 | 3.1 |
| L4 PV | 9.7 | 10.5 |
| L2/3 VIP | 12.2 | 12.6 |
| L2/3 SST | 2.4 | 5.3 |

**200 µm column with stand-ins vs full column, drifting gratings**
- Rates per class are mostly within about 25%. The largest misses are L4 VIP (+46%) and L6 SST (−27%).
- Orientation selectivity is weaker, most in deep layers (median OSI of L5 excitatory cells 0.23 vs 0.35).
- 8-bit weights change nothing measurable.

**Browser engine vs Python**
- LGN rates are within 7% RMS.
- Grey-screen rates per class are the same.
- Orientation tuning: L4 cells preferring a 0° grating fire 5.2 Hz vs 2.9 Hz for those preferring 90°.
- On the build server it runs at about 0.55× real time in Node.

## Rebuilding

`tools/v1/`:
- `zipstream.py` pulls one network out of the Allen Dropbox archive as it streams.
- `v1net.py` assembles the arrays.
- `lgn.py` is FilterNet in numpy (uses BMTK for the filter definitions).
- `v1sim.py` is the event-driven reference simulator.
- `subcol.py` + `proxy.py` build the sub-column with stand-ins.
- `gratings.py`, `osi.py`, `cmp.py` and `replay.py` are the checks.
- `export_v1.py` writes `data/v1/`.
- `validate_v1.js` and `tuning_v1.js` check the browser engine.

Set `V1_NET` to the extracted `core_nll_0` folder, and `V1_BASIS_CSV` / `V1_GLIF_REPO` to the V1_GLIF_model checkout.

## Credits

- Billeh et al., *Systematic integration of structural and functional data into multi-scale models of mouse primary visual cortex*, Neuron 2020.
- Allen Institute, [biorealistic-v1-model](https://github.com/AllenInstitute/biorealistic-v1-model) and J. Galván, [V1_GLIF_model](https://github.com/JavierGalvan9/V1_GLIF_model): network files, trained weights, synaptic basis functions, Neuropixels targets.
- Durand et al., *A comparison of visual response properties in the lateral geniculate nucleus and primary visual cortex of awake and anesthetized mice*, J Neurosci 2016 (LGN filters, via BMTK FilterNet).
- Allen Institute model files are covered by the Allen Institute Terms of Use.
- three.js (MIT) is vendored in `js/vendor`.
