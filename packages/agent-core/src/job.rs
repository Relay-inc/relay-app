//! Windows' counterpart of a process group: a Job Object holds a child and everything it starts, and ends them all
//! together, at `kill` or when its last handle closes (also when the process holding it dies).

use std::io;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::os::windows::process::CommandExt;
use std::process::{Child, Command};
use windows_sys::Win32::Foundation::{CloseHandle, FALSE};
use windows_sys::Win32::System::JobObjects::{AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE};
use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, CREATE_NO_WINDOW, PROCESS_TERMINATE};

/// A console program started without a window of its own. Relay is a GUI program: without this flag every agent,
/// plugin or probe it starts would open a console window.
pub const NO_WINDOW: u32 = CREATE_NO_WINDOW;

/// A Job Object whose processes all end when it is dropped.
pub struct Job(OwnedHandle);

impl Job {
    pub fn new() -> io::Result<Job> {
        let h = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if h.is_null() { return Err(io::Error::last_os_error()); }
        let job = Job(unsafe { OwnedHandle::from_raw_handle(h) });
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = unsafe { SetInformationJobObject(job.0.as_raw_handle(), JobObjectExtendedLimitInformation,
            &info as *const _ as *const _, std::mem::size_of_val(&info) as u32) };
        if ok == FALSE { return Err(io::Error::last_os_error()); }
        Ok(job)
    }
    /// Starts `cmd` without a console window and puts it in this job.
    // ponytail: the child is added right after it starts, so what it starts in its first instant escapes the job. A
    // suspended start (PROC_THREAD_ATTRIBUTE_JOB_LIST) closes that gap once std exposes it
    pub fn spawn(&self, cmd: &mut Command) -> io::Result<Child> {
        let child = cmd.creation_flags(NO_WINDOW).spawn()?;
        // not added (the job is gone, or a policy refuses it): it runs, without its children being ended with it
        unsafe { AssignProcessToJobObject(self.0.as_raw_handle(), child.as_raw_handle()) };
        Ok(child)
    }
    /// Ends every process in the job.
    pub fn kill(&self) { unsafe { TerminateJobObject(self.0.as_raw_handle(), 1) }; }
}

/// Ends the process `pid` (exit code 1). Windows has no SIGTERM for a console program without a shared console, so
/// this is the hard stop; what the process started ends with the Job Object it runs in.
pub fn kill_pid(pid: u32) -> io::Result<()> {
    let h = unsafe { OpenProcess(PROCESS_TERMINATE, FALSE, pid) };
    if h.is_null() { return Err(io::Error::last_os_error()); }
    let ok = unsafe { TerminateProcess(h, 1) };
    let e = io::Error::last_os_error();
    unsafe { CloseHandle(h) };
    if ok == FALSE { Err(e) } else { Ok(()) }
}
