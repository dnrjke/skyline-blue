# Transition Lab

**Isolated debugging tool for Host → Navigation scene transition issues**

## Purpose

The Transition Lab is designed to diagnose RAF (requestAnimationFrame) throttling and frame drops that occur during scene transitions, specifically:

- **Chrome 104ms throttle lock**: Chromium-based browsers throttling RAF to ~104ms intervals
- **Firefox incomplete transition**: Firefox rendering freeze during scene switch
- **Frame drops + Black Hole issues**: Combined rendering and performance issues

## Usage

### Launch Transition Lab

Add `?transition-lab` to the URL:

```
http://localhost:3000/?transition-lab
```

The normal game flow will be bypassed, and you'll see the Transition Lab interface.

### Running a Test

1. Click the **"START TRANSITION"** button
2. Watch as each transition phase executes
3. View real-time RAF measurements in the top panel
4. Review results when the test completes

### Test Phases

The lab simulates the complete Host → Navigation transition:

1. **HOST_IDLE**: Baseline RAF measurement in Host scene
2. **SCENE_CREATE**: New scene creation and render loop switch
3. **GLB_LOAD**: Character model loading (pilot.glb)
4. **GUI_SETUP**: GUI layer creation (AdvancedDynamicTexture)
5. **RENDER_LOOP_ACTIVE**: Final stabilization and recovery check

## What to Look For

### Chrome 104ms Lock

- **Symptom**: RAF intervals jump to ~104ms and stay locked
- **Indicator**: "⚠️ 104ms lock detected!" warning
- **Cause**: Extended main thread blocking triggers Chromium's idle throttle

### Firefox Stuck Transition

- **Symptom**: Transition starts but never completes
- **Indicator**: Render loop stops after scene switch
- **Cause**: Babylon scene disposal/creation timing issue

### Frame Drops

- **Symptom**: Individual frames taking > 100ms
- **Indicator**: "⚠️ N frame drops" in phase results
- **Cause**: Heavy synchronous operations blocking RAF

## Browser Detection

The lab automatically detects your browser and displays it at the top of the UI:

- 🌐 Chrome (may show 104ms throttle)
- 🌐 Firefox (may show incomplete transition)
- 🌐 Safari
- 🌐 Edge

## Console Access

The lab instance is exposed as `window.transitionLab` for console debugging:

```javascript
// Start a new transition test
window.transitionLab.startTransition()

// Reset the lab
window.transitionLab.reset()

// Dispose the lab
window.transitionLab.dispose()
```

## Architecture

### Files

- **launcher.ts**: Entry point, URL parameter detection
- **index.ts**: Main controller (TransitionLabController)
- **TransitionMeter.ts**: RAF measurement and analysis
- **TransitionPhases.ts**: Phase definitions and execution
- **LabUI.ts**: Babylon GUI visual interface

### Design Pattern

The Transition Lab follows the same pattern as RAF Lab:

1. **Isolated environment**: Completely independent from main game
2. **Precise measurement**: RAF timing captured at each phase
3. **Visual feedback**: Real-time UI showing current phase and RAF health
4. **Diagnosis**: Clear identification of throttle trigger points

## Known Issues

### Chrome 104ms Lock

If you see the 104ms lock:

1. Check which phase triggered it (usually GLB_LOAD or GUI_SETUP)
2. Look for synchronous operations > 50ms in that phase
3. Consider splitting work across multiple frames

### Firefox Rendering Freeze

If Firefox gets stuck:

1. Check if render loop actually started after scene switch
2. Verify scene disposal and recreation sequence
3. Look for circular dependencies in scene setup

## Future Work

Once the transition issues are resolved, this lab can remain as:

- **Regression test**: Ensure transitions stay smooth
- **Performance baseline**: Track transition performance over time
- **Debug reference**: Template for other debugging tools

## Related Documentation

- `/src/debug/raf-lab/`: RAF Lab (loading phase debugging)
- `/docs/navigation-loading/`: Navigation loading architecture
- `/src/engines/navigation/scene/NavigationScene.ts`: Actual transition implementation
