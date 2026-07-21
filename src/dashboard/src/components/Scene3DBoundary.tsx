import { Component, type ReactNode } from "react";

/**
 * Catches runtime errors from the 3D scene (a driver quirk, a WebGL context
 * loss mid-session) so a graphics failure degrades to a static panel
 * instead of taking the whole home page down. React only offers this via a
 * class component — there's no hook equivalent.
 */
export class Scene3DBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("[inkcache] 3D scene failed, falling back to static panel:", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
