import os, csv, json, requests, hashlib, shutil

sid = ""
headers = ""
problems = []
teams = []
pid = []

def Chk_Token():
    global headers
    if headers == "":
        while True:
            token = input("\nEnter the auth-token from PDOGS: ")
            if token == "":
                print("Auth-token cannot be empty. Please enter a valid one.")
                continue
            print("Validating auth-token ...")
            url = f"https://be.pdogs.ntu.im/problem/1451"
            headers_tmp = {"auth-token": token, "Content-Type": "application/json"}
            response = requests.patch(url, headers=headers_tmp)
            if response.status_code == 200:
                if response.json()["error"] == "LoginExpired":
                    print("Invalid auth-token. Please enter a valid one.")
                    continue
                else:
                    print("Auth-token is valid.")
                    headers = {"auth-token": token, "Content-Type": "application/json"}
                    break
            else:
                print(f"Error occurred when validating auth-token: {response.status_code}")
                return

def Loading_Json(problems_csv, teams_csv):
    global problems, teams, pid
    if not os.path.exists(problems_csv) or not os.path.exists(teams_csv):
        print(f"Error: {problems_csv} or {teams_csv} not found.")
        return -1
    with open(problems_csv, mode='r', encoding='utf-8') as csv_file:
        csv_reader = csv.DictReader(csv_file)
        for row in csv_reader:
            pid.append(int(row["id"]))
            problems.append({
                "id": int(row["id"]),
                "name": row["name"],
                "color": row["color"],
                "title": row["title"]
            })
    with open(teams_csv, mode='r', encoding='utf-8') as csv_file:
        csv_reader = csv.DictReader(csv_file)
        for row in csv_reader:
            teams.append({
                "id": int(row["id"]),
                "name": (row["name"].replace('(', '（').replace(')', '）') + " (" + row["school"] + ")"),
                "position": row["position"] if row["position"] != "" else "??",
                "section": row["section"] if row["section"] != "" else "??",
            })
    print("Problems and Teams data loaded successfully.")

def Reset_Data():
    print("Resetting scoreboard and backend files ...")
    if(os.path.exists("../backend/backend_file")):
        shutil.rmtree('../backend/backend_file', ignore_errors=True)
    os.mkdir("../backend/backend_file")

def Create_ContestData():
    global problems, teams
    title = input("\nPlease enter the contest title: ")
    print("Creating contest data ...")
    json_file_path = "../backend/backend_file/contest_data.json"
    data = {
        "title": title,
        "systemName": "PDOGS",
        "systemVersion": "6.0",
        "problems": problems,
        "teams": teams
    }
    with open(json_file_path, mode='w', encoding='utf-8') as json_file:
        json.dump(data, json_file, indent=4, ensure_ascii=False)
    print(f"Problems and Teams files have been converted to JSON file '{json_file_path}'.")
    print("Please make sure to restart the backend server to update contest data.")

def Reset_Admin_Account():
    while True:
        token = input("\nPlease enter the password for admin default account(Account Name: PDAO)(length must in [8,20]): ")
        if len(token) < 8 or len(token) > 20:
            print("Unlock token length must be between 8 and 20 characters. Please enter a valid one.")
            continue
        break
    data = {"PDAO": hashlib.sha256(token.encode()).hexdigest()}
    acct_path = "../backend/backend_file/account.json"
    with open(acct_path, mode='w', encoding='utf-8') as json_file:
        json.dump(data, json_file, indent=4, ensure_ascii=False)
    random_session_key = os.urandom(16).hex()
    session_path = "../backend/backend_file/session_key.txt"
    with open(session_path, mode='w', encoding='utf-8') as session_file:
        session_file.write(random_session_key)
    print("Unlock token and Session Key has been created successfully.")

def Edit_Scoreboard_Credit_File():
    global headers, sid, pid
    scoreboard_path = "../backend/backend_file/scoreboard.json"
    if sid == "":
        while True:
            sid = input("\nEnter the scoreboard id from PDOGS: ")
            if sid == "" or int(sid) <= 0:
                print("Scoreboard id cannot be empty. Please enter a valid one.")
                continue
            break
    Chk_Token()
    print("Updating scoreboard credit data", sid, "...")
    data = {
        "sid": sid,
        "token": headers["auth-token"],
        "frozen": False
    }
    with open(scoreboard_path, mode='w', encoding='utf-8') as json_file:
        json.dump(data, json_file, indent=4, ensure_ascii=False)
    print("Credit files have been created successfully, scoreboard has been frozen.")
    url = f"https://be.pdogs.ntu.im/team-contest-scoreboard/{sid}"
    data = {
        "challenge_label": "X",
        "title": "X",
        "target_problem_ids": pid,
        "penalty_formula": "solved_time_mins * 1 + wrong_submissions * 20",
        "team_label_filter": ""
    }
    response = requests.patch(url, json=data, headers=headers)
    if response.status_code == 200:
        if response.json()["success"]:
            print("Scoreboard has been updated successfully.")
        else:
            print(response.json()['error'])
    else:
        print(f"Error occurred: {response.status_code}")

def Edit_LazyJudge():
    global headers, pid
    Chk_Token()
    while True:
        flag = input("\nDo you want to enable lazy judge? (y/n): ").strip().lower()
        if flag == 'y':
            print("Lazy judge is enabling.")
            flag = True
            break
        elif flag == 'n':
            print("Lazy judge is disabling.")
            flag = False
            break
        else:
            print("Invalid input. Please enter 'y' or 'n'.")
    for i in pid:
        print()
        print("Enablaing" if flag else "Disabling", "lazy judge for problem", i, "...")
        url = f"https://be.pdogs.ntu.im/problem/{i}"
        response = requests.get(url, headers=headers)
        if response.status_code == 200:
            if response.json()["success"]:
                judge_type = response.json()["data"]["judge_type"]
                if judge_type == "CUSTOMIZED":
                    print(f"Getting checker code of Problem {i}...")
                    checker_id = response.json()["data"]["judge_source"]["code_uuid"]
                    judge_url = "https://be.pdogs.ntu.im/s3-file/" + checker_id + "/url?filename=" + checker_id + "&as_attachment=true"
                    response = requests.get(judge_url, headers=headers)
                    if response.status_code == 200:
                        judge_source = response.json()["data"]["url"]
                    else:
                        print(f"Error occurred when get checker source: {response.status_code}")
                        return
                    judge_code = requests.get(judge_source)
                    if judge_code.status_code == 200:
                        judge_code = judge_code.text
                        print("Checker code fetched successfully.")
                    else:
                        print(f"Error occurred when get checker code: {judge_code.status_code}")
                        return
                    judge_source = {
                        "judge_language": "python 3.8",
                        "judge_code": judge_code,
                    }
                    data = {
                        "is_lazy_judge": flag,
                        "judge_type": judge_type,
                        "judge_source": judge_source,
                    }
                else:
                    data = {
                        "is_lazy_judge": flag,
                        "judge_type": judge_type,
                    }
                response = requests.patch(url, json=data, headers=headers)
                if response.status_code == 200:
                    if response.json()["success"]:
                        print(f"Lazy judge has been {'enabled' if flag else 'disabled'} for problem {i}.")
                        continue
                    else:
                        print(response.json()['error'])
                        return
                else:
                    print(f"Error occurred when updating lazy judge: {response.status_code}")
                    return
            else:
                print(response.json()['error'])
                return
        else:
            print(f"Error occurred when get judge type: {response.status_code}")
            return
    print("\nLazy judge has been updated successfully.")

print("Welcome to the PDOGS scoreboard tool!")
print("Loading Problems and Teams data ...")

# CSV file for problems and teams data
# Make sure to replace your problems and teams data in the CSV files
problem_csv = "ProblemsData.csv"
teams_csv = "TeamsData.csv"
if Loading_Json(problem_csv, teams_csv) == -1:
    print("Error loading data. Please check the CSV files.")
    exit(1)
while True:
    type = int(input("\nMenu:\n1. Complete Setup\n2. Create Scoreboard Contest File\n3. Create/Edit PDOGS api Credit File and Scoreboard Setting\n4. Edit Problems Lazy Judge Configuration\n5. Set Admin Default Password\n6. Exit\nEnter your choice: "))
    if type == 1:
        while True:
            confirm = input("\nThis will reset scoreboard/admin backend files. Do you want to continue? (y/n): ").strip().lower()
            if confirm == 'y':
                print("Continuing ...")
                break
            elif confirm == 'n':
                print("Exiting the program.")
                exit(0)
        Reset_Data()
        Create_ContestData()
        Edit_Scoreboard_Credit_File()
        Reset_Admin_Account()
        Edit_LazyJudge()
        print("Setup completed successfully.")
        print("Exiting the program.")
        break
    elif type == 2:
        Create_ContestData()
    elif type == 3:
        Edit_Scoreboard_Credit_File()
    elif type == 4:
        Edit_LazyJudge()
    elif type == 5:
        Reset_Admin_Account()
    elif type == 6:
        print("Exiting the program.")
        break
    else:
        print("Invalid choice. Please try again.")
