// Short summaries for hover cards. Classes follow the MICrONS cell-type census (aibs metamodel m-types;
// inhibitory classes by what they target, Schneider-Mizell et al. 2025).
const Info = {
  groups: [
    {name: 'L2/3 pyramidal', short: 'L2/3', sub: 'm-types L2a–c, L3a–b',
      text: 'Superficial excitatory cells. In mouse V1 they are the most sharply and sparsely tuned, and they send the main feedforward projection to higher visual areas. In MICrONS, L2/3 cells with similar responses to natural movies are more likely to be connected (Ding et al. 2025): a like-to-like wiring rule.'},
    {name: 'L4 pyramidal', short: 'L4', sub: 'm-types L4a–c',
      text: 'The main recipient layer for thalamic input from the dLGN. L4 cells relay a first cortical version of the image up to L2/3. Here, as in the data, many L4 cells already carry orientation tuning.'},
    {name: 'L5 pyramidal', short: 'L5', sub: 'L5a–b (IT), L5ET, L5NP',
      text: 'The main output layer. Extratelencephalic (ET, thick-tufted) cells project out of cortex, to targets such as the superior colliculus and higher-order thalamus; intratelencephalic (IT) cells stay within cortex; near-projecting (NP) cells form a distinct local class.'},
    {name: 'L6 pyramidal', short: 'L6', sub: 'L6 short / tall subtypes',
      text: 'The deepest excitatory layer. It includes corticothalamic cells that feed back to the thalamus and adjust its gain, and intratelencephalic cells. Few were imaged in MICrONS, so most L6 tuning here is inherited through the wiring.'},
    {name: 'Perisomatic-targeting', short: 'PTC', sub: 'mostly basket cells',
      text: 'Inhibitory cells that synapse on the soma and proximal dendrites of their targets, mostly basket cells (largely PV). Fast and strong, they scale how much output a cell makes for a given input: a candidate substrate for divisive gain control.'},
    {name: 'Dendrite-targeting', short: 'DTC', sub: 'mostly Martinotti-like (SST)',
      text: 'Inhibitory cells that target distal dendrites, many of them somatostatin-expressing Martinotti cells. They gate what reaches a cell\'s dendrites and are implicated in surround suppression.'},
    {name: 'Sparsely-targeting', short: 'STC', sub: 'often neurogliaform-like',
      text: 'Inhibitory cells whose axons make few, diffuse synapses, consistent with neurogliaform-type volume inhibition: slow, broad and untargeted.'},
    {name: 'Inhibitory-targeting', short: 'ITC', sub: 'mostly VIP-like',
      text: 'Inhibitory cells that prefer other inhibitory cells as targets, many of them VIP-expressing. Inhibiting the inhibitors disinhibits pyramidal cells; in mice this circuit is recruited by locomotion and arousal.'},
  ],
  areas: [
    {name: 'V1', text: 'Primary visual cortex: most of the volume. Receives the thalamic input and has a retinotopic map with salt-and-pepper orientation preference (no orientation columns in mice).'},
    {name: 'RL', text: 'Rostrolateral area: a higher visual area at the border with somatosensory and parietal cortex, often linked to combining vision with touch.'},
    {name: 'AL', text: 'Anterolateral area: a higher visual area whose neurons tend to prefer faster temporal and lower spatial frequencies, consistent with a role in motion.'},
    {name: 'LM', text: 'Lateromedial area: often compared to primate V2. Only a sliver of it is inside the volume, so it is quiet here.'},
  ],
};
