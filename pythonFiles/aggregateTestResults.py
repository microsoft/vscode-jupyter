# %%
import sys
import requests
import json
import zipfile
import io

authtoken = sys.argv[1]
print("Using authtoken with prefix: " + authtoken[:4])


def getRuns(createdDate):
    runsResponse = requests.get(
        "https://api.github.com/repos/microsoft/vscode-jupyter/actions/runs",
        params={"event": "push", "created": createdDate},
        headers={"Accept": "application/vnd.github+json"},
    )

    print(f"Found {len(runsResponse.json()['workflow_runs'])} runs")

    return runsResponse.json()["workflow_runs"]


def getArtifactData(id):
    testResultsResponse = requests.get(
        f"https://api.github.com/repos/microsoft/vscode-jupyter/actions/artifacts/{id}/zip",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {authtoken}",
        },
    )

    if testResultsResponse.status_code != 200:
        print(f"Error {testResultsResponse.status_code} getting artifact {id}")

    return testResultsResponse.content


def getResultsJson(zipData):
    artifact = zipfile.ZipFile(io.BytesIO(zipData))
    content = artifact.read("testresults.json")
    return json.loads(content)


def getResultsForRun(run):
    url = run["artifacts_url"]
    print(f"Getting artifacts from {url}")
    artifactsResponse = requests.get(
        url, headers={"Accept": "application/vnd.github+json"}
    )

    artifacts = artifactsResponse.json()["artifacts"]

    results = []
    for artifact in artifacts:
        if artifact["name"].startswith("TestResult-"):
            print(f"    retrieving {artifact['name']}")
            rawData = getArtifactData(artifact["id"])
            testRunResults = getResultsJson(rawData)
            results.append(
                {
                    "scenario": artifact["name"],
                    "date": run["created_at"],
                    "runUrl": run["html_url"],
                    "data": testRunResults,
                }
            )
            print(f"    {len(testRunResults)} results read")

    return results


def flattenTestResultsToFile(runResults, filename):
    resultCount = 1
    with open(filename, "w") as outfile:
        outfile.write("[\n")
        for runResult in runResults:
            print(f"writing results {resultCount} of {len(runResults)}")
            resultCount += 1
            for scenario in runResult:
                suite = []
                for testResult in scenario["data"]:
                    if (
                        testResult["event"] == "suite"
                        and len(str.strip(testResult["title"])) > 0
                    ):
                        suite.append(testResult["title"])
                    elif (
                        testResult["event"] == "suite end"
                        and len(str.strip(testResult["title"]))
                        and len(suite) > 0
                    ):
                        suite.pop()
                    elif "title" in testResult and "state" in testResult:
                        singleResult = {
                            "scenario": scenario["scenario"],
                            "suite": " - ".join(suite),
                            "testName": testResult["title"],
                            "date": scenario["date"],
                            "runUrl": scenario["runUrl"],
                            "status": testResult["state"],
                        }
                        outfile.write(json.dumps(singleResult) + ",\n")

        outfile.write("]\n")


# %%
from datetime import date
from datetime import timedelta

yesterday = date.today() - timedelta(days=1)
runs = getRuns(yesterday)

# %%
runResults = []
for run in runs:
    if run["name"] == "Build and Test":
        runResults.append(getResultsForRun(run))

# %%
resultFile = f'AggTestResults-{yesterday.strftime("%Y-%m-%d")}.json'
allTests = flattenTestResultsToFile(runResults, resultFile)

# %%
import os

file_size = os.path.getsize(resultFile)
print(f"Wrote {file_size} bytes to {resultFile}")
