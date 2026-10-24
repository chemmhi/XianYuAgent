# Ydisks slider integration

`src/xianyu-slider-ydisks.ts` adapts the trajectory generation and gesture
contract from `utils/slider_ydisks.py` and `utils/xianyu_slider_stealth.py` in
23Star/xianyu-super-butler, commit `2490eb849738539e5dc1c07444084f4b54b03287`:
https://github.com/23Star/xianyu-super-butler/tree/2490eb849738539e5dc1c07444084f4b54b03287

The upstream implementation credits Christ9038/Ydisks-Xianyu-Helper,
`internal/browser/slider.go`, for the Ydisks trajectory and retry contract.

The pinned 23Star source is licensed under GNU Affero General Public License
version 3. The complete license is included in `licenses/ydisks-AGPL-3.0.txt`.
The TypeScript adaptation and production integration were modified in this
repository on 2026-10-24. The test reference was generated independently by
executing the pinned Python trajectory generator with fixed random inputs.
