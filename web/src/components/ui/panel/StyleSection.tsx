"use client";

/**
 * Style tab: everything that is worn or coloured rather than shaped. Colouring (skin, eyes), Hair, brows
 * & beard (head hair, brows, lashes, facial hair) and Accessories (glasses). All of it reaches the voice too.
 * The thumbnails are lazy <img>s, so they only load once this tab is shown.
 */
import { AddonControls } from "@/components/ui/AddonControls";
import { ClothesControl } from "@/components/ui/ClothesControl";
import { EyeControl } from "@/components/ui/EyeControl";
import { FinishControl } from "@/components/ui/FinishControl";
import { HairControl } from "@/components/ui/HairControl";
import { EyeMakeupControl } from "@/components/ui/EyeMakeupControl";
import { FaceFormControl } from "@/components/ui/FaceFormControl";
import { LipMakeupControl } from "@/components/ui/LipMakeupControl";
import { RealisticSkinControl } from "@/components/ui/RealisticSkinControl";
import { SkinControl } from "@/components/ui/SkinControl";
import { MarksControl } from "@/components/ui/MarksControl";
import { ScanMapsControl } from "@/components/ui/ScanMapsControl";
import { SkinDetailsControl } from "@/components/ui/SkinDetailsControl";
import { HairTextureControl, SkinTextureControl } from "@/components/ui/TextureControls";

import { Block, Hint } from "./Group";

export function StyleSection() {
  return (
    <>
      <Hint>Colours, hair and glasses. The voice sees them too.</Hint>
      <Block title="Colouring">
        <SkinControl />
        <RealisticSkinControl />
        <SkinDetailsControl />
        <LipMakeupControl />
        <FaceFormControl />
        <EyeMakeupControl />
        <SkinTextureControl />
        <ScanMapsControl />
        <EyeControl />
      </Block>
      <Block title="Scars and marks">
        <MarksControl />
      </Block>
      <Block title="Hair, brows and beard">
        <HairControl />
        <HairTextureControl />
        <AddonControls categories={["eyebrows", "eyelashes", "facialHair"]} />
      </Block>
      <Block title="Accessories">
        <AddonControls categories={["glasses"]} />
      </Block>
      <Block title="Clothes">
        <ClothesControl />
      </Block>
      <Block title="Camera">
        <FinishControl />
      </Block>
    </>
  );
}
