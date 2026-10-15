# Film Canister 3D

「Moments」フィルム缶のイラストを元にした3Dモデル（three.jsで手続き生成）。

![preview](preview.png)

## ファイル

| ファイル | 用途 |
| --- | --- |
| `film-canister.glb` | Web / Spline / Blender / Rive など。Idle・Spin・Open のアニメーションクリップ入り |
| `film-canister.usdz` | iOS（RealityKit / Quick Look）。アニメーションなし |
| `canister.js` | モデル本体。`createFilmCanister()` で three.js の Group を返す |
| `index.html` | ビューア。アニメーションのプレビュー、背景切り替え、GLB / USDZ / 透過PNGの書き出し |
| `build.mjs` | `canister.js` から GLB / USDZ / preview.png を再生成 |

## ノード構成

```
FilmCanister   ← 位置・姿勢・浮遊（Idle）
  Spin         ← 缶の軸まわりの回転（Spin）
    Label      ← 青いラベル（テクスチャは焼き込み）
    CapTop     ← 上フタ（Open で外れる）
    CapSpool   ← スプール側のフタ
    SpoolHole
```

1単位 = 缶の直径。缶の軸はローカルの +Y（上フタ側）。GLBのルートはイラストと同じ角度（`HERO_POSE`）に傾けてあります。

## ビューアのプリセット

ふわふわ（Idle, 4s loop）／くるっと回転（Spin, 3s loop）／転がって登場（Roll in, 1.4s）／タップ反応（Tap, 0.6s）／フタが開く（Open, 1.6s）。
「イラスト風の粒子」は元イラストの点描（影に黒い点、ハイライトに白い点）を再現するビューア用シェーダーで、GLBには含まれません。

## 再生成

```sh
npx http-server film-canister-3d -p 8123 &
NODE_USE_ENV_PROXY=1 node film-canister-3d/build.mjs
```
