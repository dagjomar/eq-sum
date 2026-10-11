# eq-sum

Paste several [TDR Nova](https://www.tokyodawn.net/tdr-nova/) states, see each static EQ curve, and see them added together.

This is an independent project. It is not affiliated with Tokyo Dawn Records.

## What works now

- Paste one or more Nova Copy State texts (`<TDRNova … />` or `<TDRNovaGE … />`).
- Check the parsed bands against the plugin: shape, gain, frequency, high-pass, and low-pass.
- Mute, solo, rename, and reorder presets. Order is the channel order.
- Switch the magnitude scale between ±12 dB and ±24 dB, matching Nova’s EQ Filter Magnitude setting.
- Read the summed curve. Presets add in dB, which is what happens when separate plugins are stacked on one channel.

The page runs in the browser. Nothing is uploaded.

## Model

Each preset is drawn with standard bell and shelf filters, plus Butterworth high-pass and low-pass slopes. Wideband gain is a flat offset.

Nova’s own bands are parallel, with a residual wide band. A single band at 0 dB wideband gain should look familiar. Overlapping bands inside one preset, or a wideband gain other than 0 dB, can disagree with Nova’s yellow curve. The sum across presets is exact only once each preset’s curve matches.

Dynamics, dry mix, bypass, delta, auto-gain, and output gain are reported when they are present. They are not folded into the curve.

## Match

The Match tab freezes the chain sum as a dashed reference. Add up to three Novas and shape each one by hand: four bands, plus a high-pass and low-pass. Copy a Paste State back into Nova. Automatic fitting is still a later step.

## Develop

```bash
npm install
npm test
npm run dev
```
