// Keeps the Mac from idle-sleeping while a conversation has a turn running (#80): an IOKit
// PreventUserIdleSystemSleep assertion, taken when the first turn starts and released when the last one ends.
// Idle sleep only, so closing the lid still sleeps the Mac. macOS drops the assertion with the process, also on a crash.
// Checked every 2 s instead of at each change of turns: procs come and go in many places (stop, exit, move, quit).

use super::App;
use tauri::{AppHandle, Manager};

#[cfg(target_os = "macos")]
mod iokit {
    use std::ffi::{c_char, c_void};
    type CFStringRef = *const c_void;
    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOPMAssertionCreateWithName(kind: CFStringRef, level: u32, name: CFStringRef, id: *mut u32) -> i32;
        fn IOPMAssertionRelease(id: u32) -> i32;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(alloc: *const c_void, s: *const c_char, encoding: u32) -> CFStringRef;
        fn CFRelease(cf: *const c_void);
    }
    const UTF8: u32 = 0x0800_0100;
    const ON: u32 = 255; // kIOPMAssertionLevelOn

    /// The assertion's id, or None when IOKit refused it.
    pub fn take() -> Option<u32> {
        unsafe {
            let kind = CFStringCreateWithCString(std::ptr::null(), c"PreventUserIdleSystemSleep".as_ptr(), UTF8);
            let name = CFStringCreateWithCString(std::ptr::null(), c"Relay: conversations running".as_ptr(), UTF8);
            let mut id = 0;
            let ok = IOPMAssertionCreateWithName(kind, ON, name, &mut id) == 0;
            CFRelease(kind);
            CFRelease(name);
            ok.then_some(id)
        }
    }
    pub fn release(id: u32) { unsafe { IOPMAssertionRelease(id); } }
}

pub fn start(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let h = app.clone();
        std::thread::spawn(move || {
            let mut held: Option<u32> = None;
            loop {
                let st = h.state::<App>();
                let on = st.settings.lock().unwrap()["keepAwake"] != false;
                let running = on && st.procs.lock().unwrap().values().any(|p| p.turns > 0);
                match (running, held) {
                    (true, None) => held = iokit::take(),
                    (false, Some(id)) => { iokit::release(id); held = None; }
                    _ => {}
                }
                std::thread::sleep(std::time::Duration::from_secs(2));
            }
        });
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    fn assertion_shows_in_pmset_and_goes_away() {
        let listed = || String::from_utf8(std::process::Command::new("pmset").args(["-g", "assertions"]).output().unwrap().stdout)
            .unwrap().contains("Relay: conversations running");
        let id = super::iokit::take().expect("assertion");
        assert!(listed());
        super::iokit::release(id);
        assert!(!listed());
    }
}
