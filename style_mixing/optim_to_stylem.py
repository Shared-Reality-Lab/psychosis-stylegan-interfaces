import json
import csv
import argparse
import os
import os.path
import re
import shutil

def main():
    # parse args
    parser = argparse.ArgumentParser(description="Formatting raw data from optimization approach (path.csv) to style mixing")
    parser.add_argument('--source-dir',help="Directory named after user ID containing data for passes 1 and 2", metavar='DIR', required=True)
    parser.add_argument('--image-dir',help="Directory where the original images are",metavar='DIR',required=True)
    parser.add_argument('--result-dir',help="Directory where the formatted output will be stored",metavar='DIR',required=True)
    args = parser.parse_args()

    pass_dirs = os.listdir(args.source_dir)
    pattern_id = "(\d{1,2})\/$"
    user_id = re.search(pattern_id,args.source_dir)
    if user_id is None:
        return("Invalid source folder, must be named after participant ID")
    else:
        user_id = user_id.group(1)
        if os.path.exists(args.result_dir+'%s' % (user_id)):
            return("Already formatted data for this user")
        else:
            os.makedirs(args.result_dir+'%s' % (user_id))

    for pass_dir in pass_dirs:
        pattern_pass = "(\d{1,2})"
        num_pass = re.search(pattern_pass,pass_dir)
        if num_pass is not None:
            num_pass = num_pass.group(1)

            # load data from path.csv
            data = []
            output_dict = {}
            with open(args.source_dir+num_pass+'/path.csv', 'r') as csvfile:
                csvreader = csv.reader(csvfile,delimiter=',')
                for row in csvreader:
                    if row[2] not in data:
                        data.append(row[2])
            
            # create output dict and directory
            os.makedirs(args.result_dir+'%s/%s' % (user_id,num_pass))
            path = args.result_dir+'%s/%s/' % (user_id,num_pass)
            for idx,image in enumerate(data):
                output_dict[idx] = '/'+path+image

            # store image paths in selections.csv
            with open(args.result_dir+'%s/%s/selections.json' % (user_id,num_pass),'w') as jsonfile:
                json.dump(output_dict, jsonfile, indent=4)
            
            # copy image files in folder and best solution image
            for image in data:
                shutil.copy2(args.image_dir+image,path)
                shutil.copy2(args.image_dir+data[len(data) - 1],path+'best_choice.png')
            


    return("Successfully formatted data")

if __name__ == "__main__":
    status = main()
    print(status)


