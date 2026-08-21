import { HomeProfileAction, type HomeProfileActionProps } from "./HomeProfileAction";
import { MaterialLibraryHeaderAction } from "./MaterialLibraryHeaderAction";

export function HomeMastheadActions({ runtime, navigate }: HomeProfileActionProps) {
  return (
    <div className="masthead-actions">
      <MaterialLibraryHeaderAction />
      <HomeProfileAction navigate={navigate} runtime={runtime} />
    </div>
  );
}
