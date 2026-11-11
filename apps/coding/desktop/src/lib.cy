import { configure_window } from neiv.lib;

export c("neiv_app_configure") fn configure(): void {
    const configured = configure_window("Harngine Coding", 1080, 760);
}

// @neiv {"name":"coding.nativeReady","returns":"boolean"}
pub fn native_ready(): c_int { return 1; }
