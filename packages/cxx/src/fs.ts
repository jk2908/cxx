import { renameSync, rmSync, writeFileSync } from 'node:fs'
import fs from 'node:fs/promises'

function isNodeError(err: unknown): err is Error & { code: string } {
	return err instanceof Error && 'code' in err
}

/**
 * Returns whether the error was caused by a missing file or directory.
 */
export function isENOENT(err: unknown) {
	return isNodeError(err) && err.code === 'ENOENT'
}

/**
 * Returns whether the error was caused by a file that already exists.
 */
export function isEEXIST(err: unknown) {
	return isNodeError(err) && err.code === 'EEXIST'
}

/**
 * Read a directory, returning an empty list when it does not exist.
 */
export async function readdirOrEmpty(dir: string) {
	try {
		return await fs.readdir(dir)
	} catch (err) {
		if (isENOENT(err)) return []
		throw err
	}
}

/**
 * Write a file by writing to a unique temporary file and renaming it into place, so concurrent
 * writers never observe a partial file. The temp file is cleaned up if the rename fails.
 */
export function writeFileAtomic(filePath: string, content: string) {
	const tmp = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`

	writeFileSync(tmp, content)

	try {
		renameSync(tmp, filePath)
	} catch (err) {
		rmSync(tmp, { force: true })
		throw err
	}
}

/**
 * Write a file only if the content differs from what is already on disk, so watchers are not woken
 * by a needless mtime change.
 */
export async function maybeWrite(filePath: string, content: string) {
	try {
		if ((await fs.readFile(filePath, 'utf-8')) === content) return false
	} catch (err) {
		if (!isENOENT(err)) throw err
	}

	writeFileAtomic(filePath, content)

	return true
}
