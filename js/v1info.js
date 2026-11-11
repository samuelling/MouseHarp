// Hover summaries. V1 classes follow the Allen biorealistic V1 model (17 classes from transcriptomic/morphological types);
// LGN units follow its FilterNet front end (fit to recorded mouse dLGN responses, Durand et al. 2016).
const Info = {
  groups: [
    {name: 'LGN ON', short: 'ON', sub: 'sustained ON units',
      text: 'Thalamic relay cells that fire when their patch of the visual field gets brighter. Each has a centred Gaussian receptive field and a temporal filter fit to recorded mouse dLGN cells; together with the ON/OFF cells they are the only route by which the image reaches V1 in this model. Strings are arranged left to right across the visual field.'},
    {name: 'LGN OFF', short: 'OFF', sub: 'sustained & transient OFF, ON/OFF',
      text: 'Thalamic relay cells driven by darkening, some sustained and some transient (the fastest units), plus cells with an ON and an OFF subfield side by side, which already respond best to edges of one orientation. Mouse V1 orientation tuning is built on how these ON and OFF fields are arranged in each cell\'s LGN input.'},
    {name: 'L2/3 excitatory', short: 'L2/3', sub: 'Cux2 pyramidal cells',
      text: 'Superficial pyramidal cells: the most selective and the sparsest firing in mouse V1, and the main feedforward output to higher visual areas. In this model about half of their excitatory synaptic weight comes straight from the LGN, the rest from L4 and other cortical cells.'},
    {name: 'L4 excitatory', short: 'L4', sub: 'Scnn1a, Rorb, Nr5a1, other',
      text: 'The main thalamorecipient layer: about three quarters of an L4 cell\'s excitatory synaptic weight here comes from the LGN. L4 cells pool ON and OFF LGN inputs whose fields line up into an elongated receptive field, which is where orientation tuning appears.'},
    {name: 'L5 excitatory', short: 'L5', sub: 'IT, ET, NP',
      text: 'The output layer. ET (thick-tufted) cells project out of cortex and fire fast; IT cells stay within cortex; NP cells form a distinct near-projecting class.'},
    {name: 'L6 excitatory', short: 'L6', sub: 'Ntsr1 corticothalamic',
      text: 'Corticothalamic cells that, in the brain, feed back to the LGN and adjust its gain. That loop is not in this model, so here they only listen; most of their input is cortical (under a fifth from the LGN).'},
    {name: 'PV interneurons', short: 'PV', sub: 'Pvalb, all layers',
      text: 'Fast-spiking basket cells that target cell bodies. Broadly tuned and strongly driven, they scale the response of their neighbours: a classic candidate for divisive normalization.'},
    {name: 'SST interneurons', short: 'SST', sub: 'Sst, all layers',
      text: 'Dendrite-targeting cells (many Martinotti cells). They grow with stimulus size and are implicated in surround suppression.'},
    {name: 'VIP interneurons', short: 'VIP', sub: 'Vip and L1 Htr3a',
      text: 'Cells that mostly inhibit other interneurons (especially SST), so they disinhibit pyramidal cells. In mice they are recruited by running and arousal.'},
  ],
};
