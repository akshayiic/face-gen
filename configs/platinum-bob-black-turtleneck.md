# Face to Voice character config

Saved 2026-11-21 14:32 UTC. To load it, open Face to Voice and choose **Config → Import config**.

## Look

|  |  |
|---|---|
| Skin tone | porcelain |
| Eye colour | blue grey |
| Hair | haircs-v0-00946, platinum |
| Hair worn | down; volume -0.40, flyaways 15 %, shine ×1.40 |
| Eyebrows | sparse |
| Eyelashes | fair |
| Facial hair | none |
| Glasses | none |
| Expression | neutral, 50 % |
| Head | turn 0°, tilt 0°, roll 0° |
| Gaze | 0° across, 0° up |

## Clothes

|  |  |
|---|---|
| Style | turtleneck |
| Colour | #1d1d20 |
| Inner layer | #f2f0ec |
| Fabric | knit |
| Fit | +0.10 |
| Shoulders | -0.20 |
| Build | -0.20 |
| Neckline | 0.00 |

## Shape

| Slider | Value |
|---|---|
| Age | -0.15 |
| Brow height | +0.20 |
| Brow ridge | -0.60 |
| Cheek fullness | -0.20 |
| Cheekbones | +0.30 |
| Chin width | -0.50 |
| Eye size | +0.20 |
| Face length | +0.30 |
| Head size | -0.20 |
| Jaw width | -0.40 |
| Lip fullness | +0.20 |
| Neck length | +0.30 |
| Neck thickness | -0.60 |
| Nose bridge | +0.30 |
| Nose width | -0.30 |
| Upper lip fullness | -0.20 |

## Skin details

|  |  |
|---|---|
| Blush | 10 % |
| Freckles | 35 % |
| Moles | 2 (size 20 %, placement 3) |
| Pores | ×1.30 |
| Under the eyes | ×1.30 |
| Tone variation | ×1.40 |
| Veins | 50 % |
| Wrinkles | 10 % |
| Expression lines | ×1.00 |
| Sun damage | 0 % |
| Sun spots | 10 % |
| Broken capillaries | 25 % |
| Oiliness | ×0.70 |
| Sweat | 0 % |
| Grime | 0 % |
| Lipstick | #d68a86 at 60 % |
| Lip liner | none |
| Lip finish | ×0.60 |

## Scars and marks

None.

## Fine shape and sculpt

|  |  |
|---|---|
| eye bags | +0.20 |
| asymmetry | 25 % |
| sculpted by hand | no |

## Textures

| Slot | Texture |
|---|---|
| Skin texture | none |
| Hair texture | none |
| Skin normal map | none |
| Skin roughness map | none |
| Skin cavity map | none |

## Camera

|  |  |
|---|---|
| Light | studio |
| Photo finish | on |
| Skin translucency | 70 % |
| Clarity | 30 % |
| Depth of field | f/10.0 |
| Bloom | 30 % |
| Colour grade | 30 % |
| Vignette | 0 % |
| Film grain | 20 % |

## Settings data

The app reads this block when you import the file (the tables above are for reading). Values it doesn't know are ignored and numbers are kept in range.

```json
{
  "format": "face-to-voice/config",
  "version": 1,
  "savedAt": "2026-11-21T14:32:32.253Z",
  "character": {
    "format": "face-to-voice/character",
    "version": 1,
    "sliders": 2,
    "shape": {
      "sem_age": -0.15,
      "sem_head_size": -0.2,
      "sem_face_length": 0.3,
      "sem_jaw_width": -0.4,
      "sem_chin_width": -0.5,
      "sem_cheekbones": 0.3,
      "sem_cheek_fullness": -0.2,
      "sem_nose_width": -0.3,
      "sem_nose_bridge": 0.3,
      "sem_lip_fullness": 0.2,
      "sem_upper_lip": -0.2,
      "sem_eye_size": 0.2,
      "sem_brow_ridge": -0.6,
      "sem_brow_height": 0.2,
      "sem_neck_thickness": -0.6,
      "sem_neck_length": 0.3
    },
    "emotion": "neutral",
    "intensity": 0.5,
    "pose": {
      "headYaw": 0,
      "headPitch": 0,
      "headRoll": 0,
      "gazeYaw": 0,
      "gazePitch": 0
    },
    "hair": {
      "style": "haircs-v0-00946",
      "colour": "platinum",
      "tie": "down",
      "framing": true,
      "volume": -0.4,
      "frizz": 0.15,
      "shine": 1.4
    },
    "addons": {
      "eyebrows": "sparse",
      "eyelashes": "fair",
      "facialHair": "none",
      "glasses": "none"
    },
    "skin": "porcelain",
    "eyes": "blue-grey",
    "clothes": {
      "style": "turtleneck",
      "colour": "#1d1d20",
      "inner": "#f2f0ec",
      "fabric": "knit",
      "fit": 0.1,
      "shoulders": -0.2,
      "build": -0.2,
      "neckline": 0
    },
    "skinDetails": {
      "blush": 0.1,
      "freckles": 0.35,
      "moles": 2,
      "moleSize": 0.2,
      "moleSeed": 3,
      "pores": 1.3,
      "underEye": 1.3,
      "variation": 1.4,
      "veins": 0.5,
      "eyeRims": 0.6,
      "wrinkles": 0.1,
      "expression": 1,
      "sun": 0,
      "sunSpots": 0.1,
      "capillaries": 0.25,
      "oiliness": 0.7,
      "sweat": 0,
      "grime": 0,
      "lipColour": "#d68a86",
      "lipOpacity": 0.6,
      "lipLiner": 0,
      "lipLinerColour": "",
      "lipGloss": 0.6
    },
    "marks": [],
    "fineShape": {
      "sliders": {
        "eyeBags": 0.2
      },
      "asymmetry": 0.25,
      "asymSeed": 5
    }
  },
  "textures": {},
  "finish": {
    "on": true,
    "focus": 0.2,
    "bloom": 0.3,
    "grain": 0.2,
    "vignette": 0,
    "grade": 0.3,
    "clarity": 0.3,
    "skin": 0.7,
    "light": "studio",
    "backdrop": "grey"
  }
}
```
