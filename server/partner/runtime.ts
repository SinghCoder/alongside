const DOCKER_START_FAILURE = 125

export function runtimeIssue(result: { exitCode: number; stderr: string }): string | null {
  const startupFailed = result.exitCode === DOCKER_START_FAILURE
    || result.stderr.includes(`exit status ${DOCKER_START_FAILURE}`)
  if (result.exitCode === 0 || !startupFailed || !result.stderr.includes('docker:')) { return null }

  return result.stderr.includes('no space left on device')
    ? 'Drawing runtime unavailable: the Docker disk is full. Free disk space, then retry this question.'
    : 'Drawing runtime could not start. Check Docker, then retry this question.'
}
