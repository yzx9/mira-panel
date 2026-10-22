// Print "locked"/"unlocked" (line-delimited, stdout) as the Mac's screen
// state changes; the first line is the best-known current state. Built by
// the flake's darwin module (swiftc, system frameworks only). Must run in
// a logged-in GUI session — the launchd user agent that also runs the
// companion satisfies this.
import Foundation
import CoreGraphics // CGSessionCopyCurrentDictionary

func post(_ state: String) {
    print(state)
    fflush(stdout) // stdout is a pipe -> fully buffered without this
}

let center = DistributedNotificationCenter.default()
for (name, state) in [("com.apple.screenIsLocked", "locked"),
                      ("com.apple.screenIsUnlocked", "unlocked")] {
    center.addObserver(forName: Notification.Name(name), object: nil,
                       queue: OperationQueue.main) { _ in post(state) }
}

// Initial level: long-stable (undocumented) session-dictionary key; if the
// query fails, stay silent — the companion then assumes locked (fail-safe:
// presence off until a real unlock event arrives).
if let session = CGSessionCopyCurrentDictionary() as? [String: Any] {
    post(session["CGSSessionScreenIsLocked"] == nil ? "unlocked" : "locked")
}

RunLoop.main.run()
