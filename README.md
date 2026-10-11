# One Curve

## The problem to solve

You have added too many equalizer instances, each correcting a different part, and now you have lost control. Today that stack is TDR Nova instances, each doing one correction, until the combined curve is no longer something you can see or reason about.

## The solution

This tool helps you combine the EQs to a single curve and lets you try to estimate that curve with one or more EQs, so you can simplify your EQ stack, reduce the number of bands, and keep things simple. Paste those Copy States, see them added into one curve, then shape that curve back down with fewer EQs (one or more, up to three Novas in this app).

It is tailored for [TDR Nova](https://www.tokyodawn.net/tdr-nova/) and Nova GE Copy State / Paste State right now. It runs in the browser. Nothing is uploaded.

One Curve is an independent project. The repository is still named eq-sum. It is not affiliated with or endorsed by Tokyo Dawn Records, and there is no collaboration. The author would love the TDR Nova team to reach out. This is a feature they would love to see built into TDR Nova, or offered as a separate downloadable plugin.

## Chain

![Two pasted Nova states and their yellow sum](docs/chain.png)

Paste two or more Copy State strings. Each curve stays on the graph, and the yellow line is those curves added in dB.

## Match

![A dashed reference with editable nodes, the band row, and knobs](docs/match.png)

Freeze the chain sum as a dashed reference. Shape up to three smaller Novas, four bands each plus a high-pass and a low-pass, by dragging nodes or turning the knobs. Copy state when it is close enough to paste back.

## Preview

![The held eye showing only the yellow sum and the dashed reference](docs/preview.png)

Hold the eye at the top-right of the Match graph to hide the nodes and leave only the yellow sum and the dashed reference.

## How to use

1. In TDR Nova, use Copy State.
2. Paste that text here and add it. Repeat for each Nova in the stack. The Example button loads two sample states if you want to try it without a DAW.
3. Check shape, gain, frequency, high-pass, and low-pass against the plugin. Mute, solo, rename, and reorder the chain. Switch the scale between ±12 dB and ±24 dB to match Nova’s magnitude setting.
4. Open Match. The dashed line follows the chain sum. Add up to three Novas and shape them against that line.
5. Copy state, then Paste State back into Nova.

## Limits

Static curves only. There is no audio processing.

Dynamics, dry mix, bypass, delta, auto-gain, and output gain are called out when a state includes them. They are not drawn into the curve.

Inside one Nova, bells are parallel. Overlapping cuts or boosts follow the stronger band, and the skirts meet in a round join instead of stacking. Across separate plugins, dB addition is the model once each curve is right.

## Develop

```bash
npm install
npm test
npm run dev
```

## License

Copyright 2026 dagjomar.

Current versions are licensed under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/). You can use, fork, and change this project for any noncommercial purpose. Commercial use is reserved for dagjomar.

A contribution is licensed on the same terms, and it also grants dagjomar a perpetual right to use that contribution commercially, including in a paid plugin.

Versions already published under the MIT License, through commit `50784fe`, stay available under MIT. This change does not rewrite that history.
