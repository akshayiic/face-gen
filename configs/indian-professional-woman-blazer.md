# Face to Voice character config

Saved 2026-11-20 14:03 UTC. To load it, open Face to Voice and choose **Config → Import config**.

## Look

|  |  |
|---|---|
| Skin tone | tan |
| Eye colour | dark brown |
| Hair | haircs-v0-00880, black |
| Eyebrows | feathered |
| Eyelashes | long |
| Facial hair | none |
| Glasses | none |
| Expression | happy, 55 % |
| Head | turn 6°, tilt 0°, roll 2° |
| Gaze | -4° across, 0° up |

## Clothes

|  |  |
|---|---|
| Style | blazer |
| Colour | #1f2a48 |
| Inner layer | #f2f0ec |
| Fabric | cotton |
| Fit | -0.20 |
| Shoulders | -0.40 |
| Build | -0.30 |
| Neckline | 0.00 |

## Shape

| Slider | Value |
|---|---|
| Age | -0.35 |
| Brow height | +0.50 |
| Brow ridge | -1.10 |
| Cheek fullness | +0.35 |
| Cheekbones | +0.50 |
| Chin length | -0.20 |
| Chin width | -1.00 |
| Ear size | -0.30 |
| Eye depth | +0.20 |
| Eye size | +0.90 |
| Eye tilt | +0.20 |
| Face length | +0.05 |
| Head shape 1 | +0.45 |
| Head size | -0.40 |
| Jaw width | -0.80 |
| Jowls and double chin | -0.90 |
| Lip fullness | +0.80 |
| Lower lip fullness | +0.40 |
| Mouth width | +0.10 |
| Neck length | +0.50 |
| Neck thickness | -1.20 |
| Nose projection | +0.20 |
| Nose tip | -0.10 |
| Nose width | -0.10 |
| Philtrum length | -0.40 |
| Skull width | -0.40 |
| Smile ↔ frown | +0.35 |
| Upper lip fullness | +0.30 |

## Skin details

|  |  |
|---|---|
| Blush | 20 % |
| Freckles | 0 % |
| Moles | 1 (size 25 %, placement 7) |
| Pores | ×0.80 |
| Under the eyes | ×1.00 |
| Tone variation | ×1.00 |
| Veins | 20 % |

## Textures

| Slot | Texture |
|---|---|
| Skin texture | none |
| Hair texture | none |

## Camera

|  |  |
|---|---|
| Photo finish | on |
| Depth of field | f/4.0 |
| Bloom | 40 % |
| Colour grade | 50 % |
| Vignette | 40 % |
| Film grain | 30 % |

## Settings data

The app reads this block when you import the file (the tables above are for reading). Values it doesn't know are ignored and numbers are kept in range.

```json
{
  "format": "face-to-voice/config",
  "version": 1,
  "savedAt": "2026-11-20T14:03:38.086Z",
  "character": {
    "format": "face-to-voice/character",
    "version": 1,
    "sliders": 2,
    "shape": {
      "sem_age": -0.35,
      "sem_head_size": -0.4,
      "sem_head_width": -0.4,
      "sem_neck_thickness": -1.2,
      "sem_neck_length": 0.5,
      "sem_face_length": 0.05,
      "sem_cheekbones": 0.5,
      "sem_cheek_fullness": 0.35,
      "sem_jowls": -0.9,
      "sem_jaw_width": -0.8,
      "sem_chin_length": -0.2,
      "sem_chin_width": -1,
      "sem_eye_size": 0.9,
      "sem_eye_tilt": 0.2,
      "sem_eye_depth": 0.2,
      "sem_brow_height": 0.5,
      "sem_brow_ridge": -1.1,
      "sem_nose_width": -0.1,
      "sem_nose_projection": 0.2,
      "sem_nose_tip": -0.1,
      "sem_mouth_width": 0.1,
      "sem_lip_fullness": 0.8,
      "sem_upper_lip": 0.3,
      "sem_lower_lip": 0.4,
      "sem_philtrum": -0.4,
      "sem_ear_size": -0.3,
      "fx_smile": 0.35,
      "head_000": 0.45
    },
    "emotion": "happy",
    "intensity": 0.55,
    "pose": {
      "headYaw": 6,
      "headPitch": 0,
      "headRoll": 2,
      "gazeYaw": -4,
      "gazePitch": 0
    },
    "hair": {
      "style": "haircs-v0-00880",
      "colour": "black"
    },
    "addons": {
      "eyebrows": "feathered",
      "eyelashes": "long",
      "facialHair": "none",
      "glasses": "none",
      "facialHairColour": "hair"
    },
    "skin": "tan",
    "eyes": "dark-brown",
    "clothes": {
      "style": "blazer",
      "colour": "#1f2a48",
      "inner": "#f2f0ec",
      "fabric": "cotton",
      "fit": -0.2,
      "shoulders": -0.4,
      "build": -0.3,
      "neckline": 0
    },
    "skinDetails": {
      "blush": 0.2,
      "freckles": 0,
      "moles": 1,
      "moleSize": 0.25,
      "moleSeed": 7,
      "pores": 0.8,
      "underEye": 1,
      "variation": 1,
      "veins": 0.2
    }
  },
  "textures": {},
  "finish": {
    "on": true,
    "focus": 0.5,
    "bloom": 0.4,
    "grain": 0.3,
    "vignette": 0.4,
    "grade": 0.5
  }
}
```
